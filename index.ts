#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"

// Maximum number of search results to return
const SEARCH_LIMIT = 200

// Command line argument parsing
const args = process.argv.slice(2)
if (args.length === 0) {
  console.error("Usage: mcp-obsidian <vault-directory>")
  process.exit(1)
}

// Normalize all paths consistently
function normalizePath(p: string): string {
  return path.normalize(p).toLowerCase()
}

function expandHome(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return path.join(os.homedir(), filepath.slice(1))
  }
  return filepath
}

// Store allowed directories in normalized form
const vaultDirectories = [normalizePath(path.resolve(expandHome(args[0])))]

// Validate that all directories exist and are accessible
await Promise.all(
  args.map(async (dir) => {
    try {
      const stats = await fs.stat(dir)
      if (!stats.isDirectory()) {
        console.error(`Error: ${dir} is not a directory`)
        process.exit(1)
      }
    } catch (error) {
      console.error(`Error accessing directory ${dir}:`, error)
      process.exit(1)
    }
  })
)

// Security utilities
async function validatePath(requestedPath: string): Promise<string> {
  // Ignore hidden files/directories starting with "."
  const pathParts = requestedPath.split(path.sep)
  if (pathParts.some((part) => part.startsWith("."))) {
    throw new Error("Access denied - hidden files/directories not allowed")
  }

  const expandedPath = expandHome(requestedPath)
  const absolute = path.isAbsolute(expandedPath)
    ? path.resolve(expandedPath)
    : path.resolve(process.cwd(), expandedPath)

  const normalizedRequested = normalizePath(absolute)

  // Check if path is within allowed directories
  const isAllowed = vaultDirectories.some((dir) =>
    normalizedRequested.startsWith(dir)
  )
  if (!isAllowed) {
    throw new Error(
      `Access denied - path outside allowed directories: ${absolute} not in ${vaultDirectories.join(
        ", "
      )}`
    )
  }

  // Handle symlinks by checking their real path
  try {
    const realPath = await fs.realpath(absolute)
    const normalizedReal = normalizePath(realPath)
    const isRealPathAllowed = vaultDirectories.some((dir) =>
      normalizedReal.startsWith(dir)
    )
    if (!isRealPathAllowed) {
      throw new Error(
        "Access denied - symlink target outside allowed directories"
      )
    }
    return realPath
  } catch (error) {
    // For new files that don't exist yet, verify parent directory
    const parentDir = path.dirname(absolute)
    try {
      const realParentPath = await fs.realpath(parentDir)
      const normalizedParent = normalizePath(realParentPath)
      const isParentAllowed = vaultDirectories.some((dir) =>
        normalizedParent.startsWith(dir)
      )
      if (!isParentAllowed) {
        throw new Error(
          "Access denied - parent directory outside allowed directories"
        )
      }
      return absolute
    } catch {
      throw new Error(`Parent directory does not exist: ${parentDir}`)
    }
  }
}

// Schema definitions
const ReadNotesArgsSchema = z.object({
  paths: z.array(z.string()),
})

const SearchNotesArgsSchema = z.object({
  query: z.string(),
})

// Add schema for writing notes
const WriteNoteArgsSchema = z.object({
  path: z.string().describe("The path to the note file relative to the vault root"),
  content: z.string().describe("The content to write to the note"),
  createIfNotExists: z.boolean().default(true).describe("Create the note if it does not exist"),
})

const ToolInputSchema = ToolSchema.shape.inputSchema
type ToolInput = z.infer<typeof ToolInputSchema>

// Server setup
const server = new Server(
  {
    name: "mcp-obsidian-extended",
    version: "1.2.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

/**
 * Search for notes in the allowed directories that match the query.
 * @param query - The query to search for.
 * @returns An array of relative paths to the notes (from root) that match the query.
 */
async function searchNotes(query: string): Promise<string[]> {
  const results: string[] = []
  
  // Split query into keywords for more flexible searching
  const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 0)

  async function search(basePath: string, currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)

      try {
        // Validate each path before processing
        await validatePath(fullPath)

        if (entry.name.endsWith(".md")) {
          // Check if file matches any of the keywords (implicit OR)
          let matches = false
          const filename = entry.name.toLowerCase()
          
          // Try exact match first
          if (filename.includes(query.toLowerCase())) {
            matches = true
          } 
          // Try regex match if possible
          else {
            try {
              matches = new RegExp(query.replace(/[*]/g, ".*"), "i").test(entry.name)
            } catch {
              // Ignore invalid regex
            }
          }
          
          // If not matched yet, try each keyword separately (with ranking by # of matches)
          if (!matches && keywords.length > 0) {
            matches = keywords.some(keyword => filename.includes(keyword))
          }
          
          if (matches) {
            // Turn into relative path
            results.push(fullPath.replace(basePath, ""))
          }
        }

        if (entry.isDirectory()) {
          await search(basePath, fullPath)
        }
      } catch (error) {
        // Skip invalid paths during search
        continue
      }
    }
  }

  await Promise.all(vaultDirectories.map((dir) => search(dir, dir)))
  return results
}

// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_notes",
        description:
          "Read the contents of multiple notes. Each note's content is returned with its " +
          "path as a reference. Failed reads for individual notes won't stop " +
          "the entire operation. Reading too many at once may result in an error.",
        inputSchema: zodToJsonSchema(ReadNotesArgsSchema) as ToolInput,
      },
      {
        name: "search_notes",
        description:
          "Searches for a note by its name. The search " +
          "is case-insensitive and matches partial names. " +
          "Queries can also be a valid regex. Returns paths of the notes " +
          "that match the query.",
        inputSchema: zodToJsonSchema(SearchNotesArgsSchema) as ToolInput,
      },
      // Add new write_note tool
      {
        name: "write_note",
        description:
          "Write content to a note in the Obsidian vault. If the note doesn't exist, " +
          "it will be created by default. Returns success or error message.",
        inputSchema: zodToJsonSchema(WriteNoteArgsSchema) as ToolInput,
      },
    ],
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params

    switch (name) {
      case "read_notes": {
        const parsed = ReadNotesArgsSchema.safeParse(args)
        if (!parsed.success) {
          throw new Error(`Invalid arguments for read_notes: ${parsed.error}`)
        }
        
        // Process each path in parallel for efficiency
        const results = await Promise.all(
          parsed.data.paths.map(async (filePath: string) => {
            try {
              // Handle paths with or without leading slash consistently
              const normalizedPath = filePath.startsWith("/") ? filePath.substring(1) : filePath
              const validPath = await validatePath(
                path.join(vaultDirectories[0], normalizedPath)
              )
              const content = await fs.readFile(validPath, "utf-8")
              return `${filePath}:\n${content}\n`
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error)
              return `${filePath}: Error - ${errorMessage}`
            }
          })
        )
        return {
          content: [{ type: "text", text: results.join("\n---\n") }],
        }
      }
      case "search_notes": {
        const parsed = SearchNotesArgsSchema.safeParse(args)
        if (!parsed.success) {
          throw new Error(`Invalid arguments for search_notes: ${parsed.error}`)
        }
        const results = await searchNotes(parsed.data.query)

        const limitedResults = results.slice(0, SEARCH_LIMIT)
        return {
          content: [
            {
              type: "text",
              text:
                (limitedResults.length > 0
                  ? limitedResults.join("\n")
                  : "No matches found") +
                (results.length > SEARCH_LIMIT
                  ? `\n\n... ${
                      results.length - SEARCH_LIMIT
                    } more results not shown.`
                  : ""),
            },
          ],
        }
      }
      // Add handler for write_note
      case "write_note": {
        const parsed = WriteNoteArgsSchema.safeParse(args)
        if (!parsed.success) {
          throw new Error(`Invalid arguments for write_note: ${parsed.error}`)
        }
        
        const { path: notePath, content, createIfNotExists } = parsed.data;
        
        try {
          // Prepare the full path
          const fullPath = path.join(vaultDirectories[0], notePath);
          const validPath = await validatePath(fullPath);
          
          // Create parent directories if they don't exist
          const directory = path.dirname(validPath);
          await fs.mkdir(directory, { recursive: true });
          
          // Check if file exists
          let fileExists = false;
          try {
            await fs.access(validPath);
            fileExists = true;
          } catch {
            // File doesn't exist
            if (!createIfNotExists) {
              throw new Error(`File does not exist: ${notePath}`);
            }
          }
          
          // Write to file
          await fs.writeFile(validPath, content, 'utf8');
          
          return {
            content: [{ 
              type: "text", 
              text: `Successfully ${fileExists ? 'updated' : 'created'} note: ${notePath}` 
            }],
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to write note: ${errorMessage}`);
        }
      }
      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    }
  }
})

// Start server
async function runServer() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error("MCP Obsidian Server running on stdio")
  console.error("Allowed directories:", vaultDirectories)
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error)
  process.exit(1)
})
