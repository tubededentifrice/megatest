# Claude Code Configuration for Megatest

## Directory Structure

```
.claude/
├── README.md              # This file
├── skills/                # Implementation standards
│   ├── megatest/          # Config generation skill
│   └── selfreview/        # Post-implementation self-review
├── agents/                # Specialized agent definitions
│   ├── coder.md           # Implementation
│   ├── reviewer.md        # Quality review
│   ├── commiter.md        # Git operations
│   └── oracle.md          # Deep research
└── commands/              # Custom commands
```

## Skills vs Agents

- **Skills** define *how* to do something (patterns, standards)
- **Agents** are *who* does something (specialized roles)

| Need | Use |
|------|-----|
| Generate `.megatest/` configs | Megatest skill |
| Self-review after coding | Selfreview skill |
| Implement code | Coder agent |
| Review changes | Reviewer agent |
| Commit changes | Commiter agent |
| Research hard problems | Oracle agent |

## Agent Workflow

```
PLAN → CODER → /selfreview → REVIEWER → COMMITER
                                 ↓
                      (CHANGES_REQUIRED → CODER)
```

## Key Principles

1. **Strict TypeScript**: No `any` without justification
2. **Quality over speed**: Review step included
3. **Separation of concerns**: Each agent has a focused role
4. **Simple and local-first**: CLI tool, no server dependencies
