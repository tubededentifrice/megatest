#!/usr/bin/env bash
# =============================================================================
# Megatest Development Tools Library
# =============================================================================
# Shared functions for all development scripts.
# Source this file from scripts.
#
# Usage:
#   #!/usr/bin/env bash
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "$SCRIPT_DIR/_lib/dev-tools.sh"
#   run_linter "$@"
# =============================================================================

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

# Paths to lint/format (relative to repo root)
LINT_PATHS="${LINT_PATHS:-cli/src}"
FORMAT_PATHS="${FORMAT_PATHS:-cli/src}"

# =============================================================================
# Helper Functions
# =============================================================================

# Get repository root from SCRIPT_DIR
get_repo_root() {
    local dir="${SCRIPT_DIR:-$(pwd)}"
    # Try git first
    if git -C "$dir" rev-parse --show-toplevel 2>/dev/null; then
        return
    fi
    # Walk up looking for biome.json marker
    local current="$dir"
    while [[ "$current" != "/" ]]; do
        if [[ -f "$current/biome.json" ]]; then
            echo "$current"
            return
        fi
        current="$(dirname "$current")"
    done
    # Default to parent of scripts dir
    echo "$(dirname "$dir")"
}

# Ensure dependencies are installed
ensure_deps() {
    local repo_root
    repo_root=$(get_repo_root)
    if [[ ! -d "$repo_root/cli/node_modules/@biomejs" ]]; then
        echo "Biome not found, running npm install..."
        (cd "$repo_root/cli" && npm install)
    fi
}

# Run biome via npx from the cli directory
biome_run() {
    local repo_root
    repo_root=$(get_repo_root)
    ensure_deps
    npx --prefix "$repo_root/cli" biome "$@"
}

# =============================================================================
# Development Commands
# =============================================================================

# Run biome linter
run_linter() {
    local extra_args="${EXTRA_LINT_ARGS:-}"
    echo "Running linter..."
    biome_run lint $LINT_PATHS $extra_args "$@"
}

# Run biome formatter
run_formatter() {
    local extra_args="${EXTRA_FORMAT_ARGS:-}"
    echo "Running formatter..."
    biome_run format --write $FORMAT_PATHS $extra_args "$@"
}

# Run biome check (lint + format)
run_check() {
    echo "Running check (lint + format)..."
    biome_run check $LINT_PATHS "$@"
}
