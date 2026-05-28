import json
import unittest
from unittest.mock import MagicMock, patch

# Import plugin handlers
from . import (
    _on_transform_tool_result,
    _on_pre_llm_call,
    _on_post_llm_call,
    _original_models
)


class MockAgent:
    def __init__(self, session_id, model):
        self.session_id = session_id
        self.model = model


class TestMcpRegistryPlugin(unittest.TestCase):

    def setUp(self):
        _original_models.clear()

    @patch("tools.registry.registry.get_entry")
    @patch("tools.registry.registry.dispatch")
    def test_transform_tool_result_skips_unsupported_tool(self, mock_dispatch, mock_get_entry):
        res = _on_transform_tool_result(
            tool_name="write_file",
            args={"path": "test.ts"},
            result='{"content": "..."}'
        )
        self.assertIsNone(res)
        mock_dispatch.assert_not_called()

    @patch("tools.registry.registry.get_entry")
    @patch("tools.registry.registry.dispatch")
    def test_transform_tool_result_skips_unsupported_extension(self, mock_dispatch, mock_get_entry):
        res = _on_transform_tool_result(
            tool_name="read_file",
            args={"path": "test.txt"},
            result='{"content": "..."}'
        )
        self.assertIsNone(res)
        mock_dispatch.assert_not_called()

    @patch("tools.registry.registry.get_entry")
    @patch("tools.registry.registry.dispatch")
    def test_transform_tool_result_skips_small_content(self, mock_dispatch, mock_get_entry):
        res = _on_transform_tool_result(
            tool_name="read_file",
            args={"path": "test.ts"},
            result='{"content": "short content"}'
        )
        self.assertIsNone(res)
        mock_dispatch.assert_not_called()

    @patch("tools.registry.registry.get_entry")
    @patch("tools.registry.registry.dispatch")
    def test_transform_tool_result_squeezes_supported_file(self, mock_dispatch, mock_get_entry):
        mock_get_entry.return_value = True
        mock_dispatch.return_value = json.dumps({"result": "squeezed structural skeleton"})

        large_content = "class MyClass {\n" + "\n".join(f"  method{i}() {{ return {i}; }}" for i in range(100)) + "\n}"
        input_result = json.dumps({"content": large_content})

        res = _on_transform_tool_result(
            tool_name="read_file",
            args={"path": "src/index.ts"},
            result=input_result
        )

        self.assertIsNotNone(res)
        res_data = json.loads(res)
        self.assertEqual(res_data["content"], "squeezed structural skeleton")
        self.assertTrue(res_data["squeezed"])
        self.assertEqual(res_data["original_size"], len(large_content))
        self.assertEqual(res_data["squeezed_size"], len("squeezed structural skeleton"))

        # Verify squeezer tool arguments
        mock_dispatch.assert_called_once()
        args = mock_dispatch.call_args[0][1]
        self.assertEqual(args["code"], large_content)
        self.assertEqual(args["language"], "typescript")
        self.assertEqual(args["options"]["aggressiveness"], "balanced")

    @patch("tools.registry.registry.get_entry")
    @patch("tools.registry.registry.dispatch")
    @patch("gc.get_objects")
    @patch("hermes_cli.config.load_config")
    def test_pre_llm_call_routes_simple_complexity(self, mock_load_config, mock_get_objects, mock_dispatch, mock_get_entry):
        mock_get_entry.return_value = True
        # Mock task complexity estimate output
        estimate_output = json.dumps({
            "complexity": "simple",
            "recommended_model": "groq/llama-3.2-3b"
        })
        mock_dispatch.return_value = json.dumps({"result": estimate_output})

        agent = MockAgent(session_id="session-123", model="deepseek-v4-pro")
        mock_get_objects.return_value = [agent]
        mock_load_config.return_value = {
            "model": {"default": "deepseek-v4-pro"},
            "auxiliary": {"compression": {"model": "deepseek-v4-flash"}}
        }

        res = _on_pre_llm_call(
            session_id="session-123",
            user_message="fix a typo in README"
        )

        self.assertIsNotNone(res)
        self.assertIn("complexity estimated as SIMPLE", res["context"])
        self.assertEqual(agent.model, "deepseek-v4-flash")
        self.assertEqual(_original_models["session-123"], "deepseek-v4-pro")

    @patch("tools.registry.registry.get_entry")
    @patch("tools.registry.registry.dispatch")
    @patch("gc.get_objects")
    def test_pre_llm_call_ignores_complex_tasks(self, mock_get_objects, mock_dispatch, mock_get_entry):
        mock_get_entry.return_value = True
        estimate_output = json.dumps({
            "complexity": "complex",
            "recommended_model": "openai/gpt-4o"
        })
        mock_dispatch.return_value = json.dumps({"result": estimate_output})

        agent = MockAgent(session_id="session-123", model="deepseek-v4-pro")
        mock_get_objects.return_value = [agent]

        res = _on_pre_llm_call(
            session_id="session-123",
            user_message="architect and design a distributed consensus protocol"
        )

        self.assertIsNone(res)
        self.assertEqual(agent.model, "deepseek-v4-pro")
        self.assertNotIn("session-123", _original_models)

    @patch("gc.get_objects")
    def test_post_llm_call_restores_original_model(self, mock_get_objects):
        agent = MockAgent(session_id="session-123", model="deepseek-v4-flash")
        mock_get_objects.return_value = [agent]
        _original_models["session-123"] = "deepseek-v4-pro"

        _on_post_llm_call(session_id="session-123")

        self.assertEqual(agent.model, "deepseek-v4-pro")
        self.assertNotIn("session-123", _original_models)

    @patch("tools.registry.registry.get_entry")
    @patch("tools.registry.registry.dispatch")
    def test_transform_tool_result_squeezes_csharp_and_vbnet(self, mock_dispatch, mock_get_entry):
        mock_get_entry.return_value = True
        mock_dispatch.return_value = json.dumps({"result": "squeezed structural skeleton"})

        large_content = "class MyClass {\n" + "\n".join(f"  void Method{i}() {{}}" for i in range(100)) + "\n}"
        input_result = json.dumps({"content": large_content})

        # Test C#
        res_cs = _on_transform_tool_result(
            tool_name="read_file",
            args={"path": "src/Program.cs"},
            result=input_result
        )
        self.assertIsNotNone(res_cs)
        self.assertEqual(mock_dispatch.call_args[0][1]["language"], "csharp")

        # Test VB.Net
        mock_dispatch.reset_mock()
        res_vb = _on_transform_tool_result(
            tool_name="read_file",
            args={"path": "src/Main.vb"},
            result=input_result
        )
        self.assertIsNotNone(res_vb)
        self.assertEqual(mock_dispatch.call_args[0][1]["language"], "vbnet")


if __name__ == "__main__":
    unittest.main()

