import asyncio
import gc
import json
import os
import sys
import threading
import unittest
from unittest.mock import patch
import importlib.machinery
import importlib.util
import concurrent.futures

# Ensure the mcp package is available
try:
    import mcp
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
except ImportError:
    raise ImportError("The 'mcp' package is required to run integration tests.")

# Load the plugin via SourceFileLoader to bypass hyphenated directory import limits
plugin_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../packages/mcp-registry/__init__.py"))
loader = importlib.machinery.SourceFileLoader("mcp_registry", plugin_path)
spec = importlib.util.spec_from_loader("mcp_registry", loader)
mcp_registry = importlib.util.module_from_spec(spec)
sys.modules["mcp_registry"] = mcp_registry
loader.exec_module(mcp_registry)

from mcp_registry import (
    _on_transform_tool_result,
    _on_pre_llm_call,
    _on_post_llm_call,
    _original_models
)


class MockAgent:
    def __init__(self, session_id: str, model: str):
        self.session_id = session_id
        self.model = model


class IntegrationRegistry:
    """Mock registry that delegates tool calls to the active MCP Gateway session."""
    def __init__(self, session, loop):
        self.session = session
        self.loop = loop

    def get_entry(self, name: str) -> bool:
        # Always return true for the gateway integration tools
        return name in ("mcp_hermes_mcp_token_squeezer_squeeze", "mcp_hermes_mcp_task_router_estimate")

    def dispatch(self, name: str, args: dict, **kwargs) -> str:
        # Map python-mcp-registry name to node-mcp-gateway name
        if "token_squeezer_squeeze" in name:
            real_name = "token_squeezer_squeeze"
        elif "task_router_estimate" in name:
            real_name = "task_router_estimate"
        else:
            real_name = name

        # Schedule the call on the background thread loop and wait
        future = asyncio.run_coroutine_threadsafe(
            self.session.call_tool(real_name, arguments=args),
            self.loop
        )
        try:
            call_res = future.result(timeout=10)
            content_text = "".join(b.text for b in call_res.content if hasattr(b, "text"))
            if call_res.isError:
                return json.dumps({"error": content_text or "MCP tool returned an error"})
            
            # Make sure it returns a JSON string with the result key
            return json.dumps({"result": content_text})
        except Exception as e:
            return json.dumps({"error": f"IntegrationRegistry dispatch failed: {e}"})


class TestFullPipelineIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.loop = None
        cls.thread = None
        cls.conn_task = None
        cls.stop_event = None
        cls.original_registry = None

        try:
            # Locate the build of packages/cli/dist/index.js
            cli_dist_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../packages/cli/dist/index.js"))
            if not os.path.exists(cli_dist_path):
                raise FileNotFoundError(f"CLI dist build not found at {cli_dist_path}. Please run 'npm run build' first.")

            # Setup background asyncio loop in a daemon thread
            cls.loop = asyncio.new_event_loop()
            cls.thread = threading.Thread(target=cls._run_loop, args=(cls.loop,), daemon=True)
            cls.thread.start()

            # Parameters for starting gateway server
            cls.client_context = stdio_client(StdioServerParameters(
                command="node",
                args=[cli_dist_path, "start"],
                env=os.environ
            ))

            cls.session = None
            cls.session_error = None
            cls.ready_event = threading.Event()

            # Runner function to enter context manager and keep session active in a single Task
            async def session_runner():
                cls.stop_event = asyncio.Event()
                try:
                    async with cls.client_context as (read_stream, write_stream):
                        async with ClientSession(read_stream, write_stream) as session:
                            await session.initialize()
                            cls.session = session
                            cls.ready_event.set()
                            await cls.stop_event.wait()
                except Exception as e:
                    cls.session_error = e
                    cls.ready_event.set()

            cls.conn_task = asyncio.run_coroutine_threadsafe(session_runner(), cls.loop)
            if not cls.ready_event.wait(timeout=15):
                raise TimeoutError("MCP gateway server connection timed out.")
            if cls.session_error:
                raise cls.session_error
            if cls.session is None:
                raise RuntimeError("MCP session failed to initialize.")

            # Wire the IntegrationRegistry into tools.registry
            import tools.registry
            cls.original_registry = tools.registry.registry
            cls.integration_registry = IntegrationRegistry(cls.session, cls.loop)
            tools.registry.registry = cls.integration_registry
        except Exception as e:
            cls.tearDownClass()
            raise e

    @classmethod
    def tearDownClass(cls):
        # Restore registry
        if getattr(cls, 'original_registry', None) is not None:
            import tools.registry
            tools.registry.registry = cls.original_registry
            cls.original_registry = None

        # Set stop event to exit the session runner context cleanly
        if getattr(cls, 'loop', None) is not None and getattr(cls, 'stop_event', None) is not None:
            cls.loop.call_soon_threadsafe(cls.stop_event.set)
        
        # Wait for the connection task to complete
        if getattr(cls, 'conn_task', None) is not None:
            concurrent.futures.wait([cls.conn_task], timeout=5)
            cls.conn_task = None

        # Stop background event loop and thread
        if getattr(cls, 'loop', None) is not None:
            cls.loop.call_soon_threadsafe(cls.loop.stop)
            if getattr(cls, 'thread', None) is not None:
                cls.thread.join(timeout=5)
                cls.thread = None
            try:
                cls.loop.close()
            except Exception:
                pass
            cls.loop = None

    def setUp(self):
        _original_models.clear()

    def test_end_to_end_token_squeezing(self):
        # A typescript source file content containing a private (non-exported) function and a public class.
        # It must be longer than 500 characters to trigger squeezing.
        typescript_code = """
        function _internalPrivateHelper(data: any): boolean {
            // This is a private function body that should be squeezed.
            const result = data !== null && typeof data === 'object';
            console.log("Running highly complex private validation logic here...");
            return result;
        }

        export class UserManager {
            private users: Map<string, any>;
            constructor() {
                this.users = new Map();
            }
            public addUser(id: string, name: string): void {
                if (_internalPrivateHelper({ id, name })) {
                    this.users.set(id, { name, registeredAt: new Date() });
                }
            }
            public getUser(id: string): any {
                return this.users.get(id);
            }
        }
        // Additional padding to make the content length greater than 500 characters
        // Padding: 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890
        // Padding: 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890
        // Padding: 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890
        // Padding: 1234567890 1234567890 1234567890 1234567890 1234567890 1234567890
        """
        # Formulate tool result matching a read_file call
        input_result = json.dumps({"content": typescript_code})

        # Run the transform_tool_result hook
        squeezed_res_str = _on_transform_tool_result(
            tool_name="read_file",
            args={"path": "src/users.ts"},
            result=input_result
        )

        self.assertIsNotNone(squeezed_res_str)
        squeezed_res = json.loads(squeezed_res_str)

        # Verify that squeezing happened and skeleton was produced
        self.assertTrue(squeezed_res["squeezed"])
        self.assertEqual(squeezed_res["original_size"], len(typescript_code))
        self.assertGreater(squeezed_res["original_size"], squeezed_res["squeezed_size"])
        self.assertIn("function _internalPrivateHelper", squeezed_res["content"])
        self.assertIn("class UserManager", squeezed_res["content"])
        
        # Verify that private function body is squeezed (e.g. implementation details are stripped)
        self.assertNotIn("Running highly complex private validation logic here...", squeezed_res["content"])

    @patch("gc.get_objects")
    @patch("hermes_cli.config.load_config")
    def test_end_to_end_task_routing(self, mock_load_config, mock_get_objects):
        session_id = "session-test-456"
        agent = MockAgent(session_id=session_id, model="deepseek-v4-pro")
        mock_get_objects.return_value = [agent]
        
        # Configure model mappings
        mock_load_config.return_value = {
            "model": {"default": "deepseek-v4-pro"},
            "auxiliary": {"compression": {"model": "deepseek-v4-flash"}}
        }

        # Prompt with simple keywords: "fix typo in README"
        res = _on_pre_llm_call(
            session_id=session_id,
            user_message="Please fix a typo in the README file."
        )

        # Verify routed context and model override
        self.assertIsNotNone(res)
        self.assertIn("complexity estimated as SIMPLE", res["context"])
        self.assertEqual(agent.model, "deepseek-v4-flash")
        self.assertEqual(_original_models[session_id], "deepseek-v4-pro")

        # Run post_llm_call to restore model
        _on_post_llm_call(session_id=session_id)
        self.assertEqual(agent.model, "deepseek-v4-pro")
        self.assertNotIn(session_id, _original_models)

    @classmethod
    def _run_loop(cls, loop):
        asyncio.set_event_loop(loop)
        loop.run_forever()


if __name__ == "__main__":
    unittest.main()
