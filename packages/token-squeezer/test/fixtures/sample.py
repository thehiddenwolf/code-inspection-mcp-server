"""
A sample Python module for TokenSqueezer testing.
"""

import json
import os
from typing import Dict, Any, Optional


def load_config(path: str) -> Dict[str, Any]:
    """Load a JSON config file and return its contents."""
    with open(path, 'r') as f:
        return json.load(f)


class ConfigManager:
    """Manages application configuration."""
    
    def __init__(self, defaults: Optional[Dict[str, Any]] = None):
        self._config = defaults or {}
    
    def get(self, key: str, default: Any = None) -> Any:
        return self._config.get(key, default)
    
    def set(self, key: str, value: Any) -> None:
        self._config[key] = value
    
    def validate(self) -> bool:
        # Check required keys
        required = ['name', 'version']
        for key in required:
            if key not in self._config:
                return False
        return True


# Internal helper
def _merge(base: Dict, overrides: Dict) -> Dict:
    result = {**base}
    result.update(overrides)
    return result
