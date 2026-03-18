import { $ } from "bun";
import * as path from "path";
import * as os from "os";

const CACHE_DIR = path.join(os.homedir(), ".cache", "my-ink-cli");
const CACHE_FILE = path.join(CACHE_DIR, "todos.json");

export interface Todo {
  id: number;
  text: string;
  completed: boolean;
  createdAt: string;      // ISO 格式创建时间
  dueAt?: string;         // 可选的截止时间
}

export interface CacheData {
  [key: string]: Todo[];
}

/**
 * 获取当前 git 分支名
 * 如果不在 git 仓库中，返回 "nogit"
 * 如果获取失败，返回 "unknown"
 */
export async function getGitBranch(): Promise<string> {
  try {
    const result = await $`git branch --show-current`.quiet();
    return result.text().trim() || "nogit";
  } catch {
    return "nogit";
  }
}

/**
 * 获取项目信息（目录和分支）
 */
export async function getProjectInfo(): Promise<{ dir: string; branch: string }> {
  const dir = process.cwd();
  const branch = await getGitBranch();
  return { dir, branch };
}

/**
 * 获取缓存 key
 * 格式: <项目目录>:<分支名>
 */
export async function getCacheKey(): Promise<string> {
  const projectDir = process.cwd();
  const branch = await getGitBranch();
  return `${projectDir}:${branch}`;
}

/**
 * 获取缓存目录路径
 */
export function getCacheDir(): string {
  return CACHE_DIR;
}

/**
 * 确保缓存目录存在
 */
async function ensureCacheDir(): Promise<void> {
  await Bun.file(CACHE_DIR).exists().catch(async () => {
    await $`mkdir -p ${CACHE_DIR}`.quiet();
  });
}

/**
 * 从缓存文件加载数据
 */
export async function loadCache(): Promise<Todo[]> {
  try {
    await ensureCacheDir();
    const file = Bun.file(CACHE_FILE);

    if (!(await file.exists())) {
      return [];
    }

    const content = await file.text();
    if (!content.trim()) {
      return [];
    }

    const data: CacheData = JSON.parse(content);
    const key = await getCacheKey();

    // 兼容旧数据：为没有 createdAt 的任务添加默认值
    const todos = data[key] || [];
    return todos.map(todo => ({
      ...todo,
      createdAt: todo.createdAt || new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

/**
 * 保存数据到缓存文件
 */
export async function saveCache(todos: Todo[]): Promise<void> {
  try {
    await ensureCacheDir();

    const file = Bun.file(CACHE_FILE);
    let data: CacheData = {};

    // 读取现有缓存数据
    if (await file.exists()) {
      const content = await file.text();
      if (content.trim()) {
        try {
          data = JSON.parse(content);
        } catch {
          data = {};
        }
      }
    }

    // 更新当前 key 的数据
    const key = await getCacheKey();
    data[key] = todos;

    // 写入缓存文件
    await Bun.write(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    // 缓存失败不影响主功能，静默处理
    console.error("Failed to save cache:", error);
  }
}
