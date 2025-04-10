# Obsidian MCP Extended

> This is a fork of [smithery-ai/mcp-obsidian](https://github.com/smithery-ai/mcp-obsidian) with added **write support** functionality.

This connector allows Claude Desktop, Cursor, or any MCP client to read, search, write to, and now **delete notes from** any directory containing Markdown notes (such as an Obsidian vault).

## What's New in This Fork

This fork adds critical new features to the original MCP server:

- **`write_note` functionality**: Allows AI assistants to create and update notes in your Obsidian vault
- **`delete_note` functionality**: Allows AI assistants to delete notes from your Obsidian vault
- Perfect for enabling long-term memory for your AI assistants
- Maintains all the security features of the original implementation
- Full backwards compatibility with the original project

## Installation

Make sure Claude Desktop/Cursor and `npm` are installed.

### Installing from Source (Recommended for write support)

To install this enhanced version with write support:

```bash
git clone https://github.com/Zafnok/mcp-obsidian-extended.git
cd mcp-obsidian-extended
npm install
npm run build
```

Then configure Cursor or Claude to use this version by pointing to the local build:

1. Open Cursor Settings (Cmd+Shift+J) or Claude Desktop settings
2. Go to the MCP tab
3. Add a new MCP server with:
   - Name: Obsidian Extended
   - Type: stdio
   - Command: `node /path/to/mcp-obsidian-extended/dist/index.js /path/to/your/vault`

### Installing Original Version via Smithery

To install the original Obsidian Model Context Protocol (without write support):

```bash
npx @smithery/cli install mcp-obsidian --client claude
```

## Available Tools

This MCP server provides the following tools:

### 1. `read_notes`
Read the contents of multiple notes. Each note's content is returned with its path as a reference.

### 2. `search_notes`
Searches for a note by its name. The search is case-insensitive and matches partial names. Queries can also be a valid regex.

### 3. `write_note` (New in this fork!)
Write content to a note in the Obsidian vault. If the note doesn't exist, it will be created by default.

Example usage:
```json
{
  "path": "folder/new-note.md",
  "content": "# My New Note\n\nThis is the content of my note.",
  "createIfNotExists": true
}
```

### 4. `delete_note` (New in this fork!)
Delete a note from the Obsidian vault. Returns success or error message.

Example usage:
```json
{
  "path": "folder/note-to-delete.md"
}
```

## Credits

- Original implementation by [Henry Mao](https://calclavia.com) and [smithery-ai](https://github.com/smithery-ai)
- Write support functionality added by Nicholas Wentz ([@Zafnok](https://github.com/Zafnok))
- All original licensing and permissions apply

## License

AGPL-3.0
