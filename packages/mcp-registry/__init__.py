"""mcp-integration plugin — Hermes MCP Toolset Integration Layer.

Squeezes code file reads via token_squeezer and routes simple tasks
to cheaper models via task_router.
"""

from __future__ import annotations

import gc
import json
import logging
import os
from typing import Any, Dict

logger = logging.getLogger(__name__)

# State map to track overridden models per session
_original_models: Dict[str, str] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_agent_by_session_id(session_id: str) -> Any | None:
    """Find the active Agent instance in memory matching the session_id."""
    if not session_id:
        return None
    try:
        for obj in gc.get_objects():
            if type(obj).__name__ in ("Agent", "MockAgent"):
                if getattr(obj, "session_id", None) == session_id:
                    return obj
    except Exception as e:
        logger.debug("Error traversing gc objects: %s", e)
    return None


def _get_configured_models() -> tuple[str, str]:
    """Load config.yaml and resolve premium (default) and cheap (flash) models.

    Returns:
        tuple[premium_model, cheap_model]
    """
    premium = "deepseek-v4-pro"
    cheap = "deepseek-v4-flash"
    try:
        from hermes_cli.config import load_config
        config = load_config()
        if isinstance(config, dict):
            # Resolve premium default model
            model_block = config.get("model", {})
            if isinstance(model_block, dict):
                premium = model_block.get("default", premium)
            # Resolve cheap model (falls back to auxiliary.compression or auxiliary.mcp model)
            aux_block = config.get("auxiliary", {})
            if isinstance(aux_block, dict):
                comp_block = aux_block.get("compression", {})
                if isinstance(comp_block, dict):
                    cheap = comp_block.get("model", cheap)
                else:
                    mcp_block = aux_block.get("mcp", {})
                    if isinstance(mcp_block, dict):
                        cheap = mcp_block.get("model", cheap)
    except Exception as e:
        logger.debug("Failed to load config.yaml for model resolution: %s", e)
    return premium, cheap


# ---------------------------------------------------------------------------
# Hook Handlers
# ---------------------------------------------------------------------------

def _on_transform_tool_result(
    tool_name: str,
    args: Dict[str, Any],
    result: str,
    **kwargs: Any
) -> str | None:
    """Intercept file-read actions to squeeze code context."""
    if tool_name not in ("read_file", "mcp_filesystem_read_file"):
        return None

    filepath = args.get("path")
    if not filepath:
        return None

    # Check file extension to determine language
    ext = os.path.splitext(filepath)[1].lower()
    ext_to_lang = {
        ".js": "javascript",
        ".ts": "typescript",
        ".py": "python",
        ".go": "go",
        ".jsx": "jsx",
        ".tsx": "tsx",
        ".cs": "csharp",
        ".vb": "vbnet",
    }
    lang = ext_to_lang.get(ext)
    if not lang:
        return None

    try:
        data = json.loads(result)
    except Exception:
        return None

    if not isinstance(data, dict):
        return None

    content = data.get("content")
    if not content or not isinstance(content, str):
        return None

    # Don't squeeze tiny files (under 500 characters)
    if len(content) < 500:
        return None

    mcp_tool_name = "mcp_hermes_mcp_token_squeezer_squeeze"
    from tools.registry import registry
    if not registry.get_entry(mcp_tool_name):
        logger.debug("Squeezer tool %s not registered in registry", mcp_tool_name)
        return None

    squeeze_args = {
        "code": content,
        "language": lang,
        "options": {
            "preserve_comments": False,
            "preserve_imports": True,
            "aggressiveness": "balanced",
            "output_format": "text",
        }
    }

    try:
        dispatch_res = registry.dispatch(mcp_tool_name, squeeze_args)
        res_data = json.loads(dispatch_res)
        if "error" in res_data:
            logger.warning("TokenSqueezer tool call returned error: %s", res_data["error"])
            return None

        squeezed_code = res_data.get("result")
        if squeezed_code:
            data["content"] = squeezed_code
            data["squeezed"] = True
            data["original_size"] = len(content)
            data["squeezed_size"] = len(squeezed_code)
            ratio = round((1 - len(squeezed_code) / len(content)) * 100, 1)
            logger.info("Squeezed file %s: %d -> %d chars (%s%% reduction)",
                        filepath, len(content), len(squeezed_code), ratio)
            return json.dumps(data, ensure_ascii=False)
    except Exception as e:
        logger.warning("Error during TokenSqueezer dispatch: %s", e)

    return None


def _on_pre_llm_call(
    session_id: str,
    user_message: str,
    **kwargs: Any
) -> Dict[str, Any] | None:
    """Estimate task complexity and optimize model routing."""
    agent = _find_agent_by_session_id(session_id)
    if not agent:
        return None

    mcp_tool_name = "mcp_hermes_mcp_task_router_estimate"
    from tools.registry import registry
    if not registry.get_entry(mcp_tool_name):
        return None

    try:
        # Get complexity estimate
        estimate_res = registry.dispatch(mcp_tool_name, {"task_description": user_message})
        res_data = json.loads(estimate_res)
        if "error" in res_data:
            return None

        result_content = res_data.get("result")
        if not result_content:
            return None

        # Parse the structured Content inside the result
        estimate = json.loads(result_content)
        complexity = estimate.get("complexity")

        if complexity == "simple":
            premium_model, cheap_model = _get_configured_models()
            current_model = getattr(agent, "model", "")
            if current_model == premium_model:
                logger.info("Routing simple task to cheap model: %s -> %s", current_model, cheap_model)
                _original_models[session_id] = current_model
                agent.model = cheap_model
                return {"context": f"[Subtask Router: complexity estimated as SIMPLE. Routed from {current_model} to {cheap_model}]"}
    except Exception as e:
        logger.debug("Error in pre_llm_call complexity routing: %s", e)

    return None


def _on_post_llm_call(session_id: str, **kwargs: Any) -> None:
    """Restore premium model after LLM generation finishes."""
    if session_id in _original_models:
        original = _original_models.pop(session_id)
        agent = _find_agent_by_session_id(session_id)
        if agent:
            logger.info("Restoring agent model to: %s -> %s", getattr(agent, "model", ""), original)
            agent.model = original


# ---------------------------------------------------------------------------
# Plugin registration
# ---------------------------------------------------------------------------

def register(ctx: Any) -> None:
    ctx.register_hook("transform_tool_result", _on_transform_tool_result)
    ctx.register_hook("pre_llm_call", _on_pre_llm_call)
    ctx.register_hook("post_llm_call", _on_post_llm_call)
    logger.info("MCP Toolset Integration Layer hooks registered successfully.")
