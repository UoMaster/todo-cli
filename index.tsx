import React, { useState, useEffect, useMemo } from 'react';
import { render, Text, Box, useInput, useApp, useStdout, useStdin, Static } from 'ink';
import TextInput from 'ink-text-input';
import { loadCache, saveCache, getProjectInfo, type Todo } from './cache.js';
import { parseDueDate, formatTime, isOverdue, isDueSoon } from './utils.js';

interface DeletedTodo {
  todo: Todo;
  index: number;
}

// 使用 Static 渲染固定的标题，避免重复渲染
const Header = () => (
  <Box
    height={1}
    paddingLeft={1}
    paddingRight={1}
    backgroundColor="cyan"
  >
    <Text bold color="black">
      TodoList
    </Text>
    <Text color="black"> | </Text>
    <Text color="black">Ink Demo</Text>
  </Box>
);

const TodoList = () => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { setRawMode } = useStdin();

  // 获取终端尺寸
  const [dimensions, setDimensions] = useState({
    width: stdout?.columns || 80,
    height: stdout?.rows || 24,
  });

  // 被删除的任务栈，用于撤回
  const [deletedStack, setDeletedStack] = useState<DeletedTodo[]>([]);

  // 任务列表
  const [todos, setTodos] = useState<Todo[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [dueInputValue, setDueInputValue] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isInputMode, setIsInputMode] = useState(false);
  const [isDueInputMode, setIsDueInputMode] = useState(false);
  const [pendingTodoText, setPendingTodoText] = useState('');
  const [message, setMessage] = useState('');

  // 项目信息（工作目录和分支）
  const [projectInfo, setProjectInfo] = useState<{ dir: string; branch: string } | null>(null);

  // 每分钟触发重新渲染，更新时间显示
  const [, setTick] = useState(0);

  useEffect(() => {
    // 检查是否有带截止时间的任务
    const hasDueTodos = todos.some(t => t.dueAt);
    if (!hasDueTodos) return;

    const interval = setInterval(() => {
      setTick(t => t + 1);
    }, 30000);

    return () => clearInterval(interval);
  }, [todos]);

  // 加载缓存数据和项目信息
  useEffect(() => {
    loadCache().then(cachedTodos => {
      if (cachedTodos.length > 0) {
        setTodos(cachedTodos);
      }
    });
    getProjectInfo().then(info => setProjectInfo(info));
  }, []);

  // 保存缓存数据
  useEffect(() => {
    saveCache(todos);
  }, [todos]);

  useEffect(() => {
    if (!stdout) return;

    const handleResize = () => {
      setDimensions({
        width: stdout.columns,
        height: stdout.rows,
      });
    };

    stdout.on('resize', handleResize);
    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

  const showMessage = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 2000);
  };

  useInput((input, key) => {
    // 截止时间输入模式
    if (isDueInputMode) {
      if (key.escape) {
        setIsDueInputMode(false);
        setDueInputValue('');
        setPendingTodoText('');
        showMessage('取消添加');
      } else if (key.return) {
        const dueAt = parseDueDate(dueInputValue);
        const newTodo: Todo = {
          id: Date.now(),
          text: pendingTodoText,
          completed: false,
          createdAt: new Date().toISOString(),
          dueAt,
        };
        setTodos([...todos, newTodo]);
        setDueInputValue('');
        setPendingTodoText('');
        setIsDueInputMode(false);
        setSelectedIndex(todos.length);
        const dueMsg = dueAt ? ` (${formatTime(dueAt)})` : '';
        showMessage(`任务已添加${dueMsg}`);
      }
      return;
    }

    if (isInputMode) {
      if (key.escape) {
        setIsInputMode(false);
        setInputValue('');
        showMessage('取消添加');
      } else if (key.return) {
        if (inputValue.trim()) {
          setPendingTodoText(inputValue.trim());
          setInputValue('');
          setIsInputMode(false);
          setIsDueInputMode(true);
        }
      }
      return;
    }

    if (key.escape || input === 'q') {
      exit();
      return;
    }

    if (input === 'a') {
      setIsInputMode(true);
      setInputValue('');
      return;
    }

    // 删除任务 (d) - 可撤回
    if (input === 'd') {
      const todo = todos[selectedIndex];
      if (todo) {
        // 保存到删除栈
        setDeletedStack(prev => [...prev, { todo, index: selectedIndex }]);
        // 删除任务
        setTodos(todos.filter(t => t.id !== todo.id));
        if (selectedIndex >= todos.length - 1) {
          setSelectedIndex(Math.max(0, todos.length - 2));
        }
        showMessage(`已删除: ${todo.text} (按 u 撤回)`);
      }
      return;
    }

    // 撤回删除 (u)
    if (input === 'u') {
      if (deletedStack.length > 0) {
        const lastDeleted = deletedStack[deletedStack.length - 1];
        // 恢复任务到原来的位置
        const newTodos = [...todos];
        newTodos.splice(lastDeleted.index, 0, lastDeleted.todo);
        setTodos(newTodos);
        setDeletedStack(prev => prev.slice(0, -1));
        setSelectedIndex(lastDeleted.index);
        showMessage(`已撤回: ${lastDeleted.todo.text}`);
      } else {
        showMessage('没有可撤回的操作');
      }
      return;
    }

    if (input === ' ') {
      const newTodos = [...todos];
      if (newTodos[selectedIndex]) {
        newTodos[selectedIndex].completed = !newTodos[selectedIndex].completed;
        setTodos(newTodos);
        const status = newTodos[selectedIndex].completed ? '完成' : '未完成';
        showMessage(`标记为 ${status}`);
      }
      return;
    }

    // 移动选择: 方向键 或 vim 键位 (hjkl)
    if (key.upArrow || input === 'k') {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
      return;
    }

    if (key.downArrow || input === 'j') {
      setSelectedIndex(Math.min(todos.length - 1, selectedIndex + 1));
      return;
    }

    // vim 风格: h 向上滚动（可选，这里用于跳转到第一项）
    if (input === 'h') {
      setSelectedIndex(0);
      return;
    }

    // vim 风格: l 向下滚动（可选，这里用于跳转到最后一项）
    if (input === 'l') {
      setSelectedIndex(Math.max(0, todos.length - 1));
      return;
    }
  });

  const completedCount = todos.filter(t => t.completed).length;
  const pendingCount = todos.length - completedCount;

  // 判断是否小窗口 (< 80 列或 < 20 行)
  const isSmallScreen = dimensions.width < 80 || dimensions.height < 20;
  // 判断是否超小窗口 (< 50 列)
  const isTinyScreen = dimensions.width < 50;

  // 截断文本函数
  const truncateText = (text: string, maxWidth: number) => {
    if (text.length <= maxWidth) return text;
    return text.slice(0, maxWidth - 3) + '...';
  };

  return (
    <Box flexDirection="column" height={dimensions.height} overflow="hidden">
      {/* 使用 Static 固定标题，避免重复渲染 */}
      <Static items={[{ id: 'header' }]}>
        {() => <Header />}
      </Static>

      {/* 主内容区 */}
      {isSmallScreen ? (
        // 小窗口：简洁单列布局
        <Box flexDirection="column" flexGrow={1}>
          {/* 简洁任务列表 */}
          <Box
            flexDirection="column"
            flexGrow={1}
            paddingX={1}
            paddingY={1}
            overflow="hidden"
          >
            {/* 简洁标题栏 */}
            <Box flexDirection="row" marginBottom={1}>
              <Text bold color="cyan">Tasks</Text>
              <Text color="gray"> ({todos.length}) </Text>
              <Text color="gray">-</Text>
              <Text color="green"> {completedCount} done</Text>
              {projectInfo && projectInfo.branch !== 'nogit' && (
                <>
                  <Text color="gray"> | </Text>
                  <Text color="yellow">{projectInfo.branch}</Text>
                </>
              )}
            </Box>

            <Box flexDirection="column">
              {todos.length === 0 ? (
                <Text dimColor>Press 'a' to add task</Text>
              ) : (
                todos.map((todo, index) => {
                  const isSelected = index === selectedIndex && !isInputMode;
                  const displayText = truncateText(todo.text, dimensions.width - 18);
                  const hasDue = !!todo.dueAt;
                  const overdue = hasDue && isOverdue(todo.dueAt!);
                  const dueSoon = hasDue && isDueSoon(todo.dueAt!);

                  return (
                    <Box key={todo.id}>
                      <Box width="100%">
                        <Text color={isSelected ? 'cyan' : 'gray'}>
                          {isSelected ? '> ' : '  '}
                        </Text>
                        <Text color={todo.completed ? 'green' : 'white'}>
                          {todo.completed ? '[x] ' : '[ ] '}
                        </Text>
                        <Text
                          strikethrough={todo.completed}
                          color={todo.completed ? 'gray' : 'white'}
                        >
                          {displayText}
                        </Text>
                        {hasDue && !todo.completed && (
                          <Text color={overdue ? 'red' : dueSoon ? 'yellow' : 'gray'}>
                            {' '}{formatTime(todo.dueAt!)}{overdue ? ' !' : ''}
                          </Text>
                        )}
                      </Box>
                    </Box>
                  );
                })
              )}
            </Box>

            {isInputMode && (
              <Box marginTop={1}>
                <Text color="yellow">{'>'} </Text>
                <TextInput
                  value={inputValue}
                  onChange={setInputValue}
                  onSubmit={(value) => {
                    if (value.trim()) {
                      setPendingTodoText(value.trim());
                      setInputValue('');
                      setIsInputMode(false);
                      setIsDueInputMode(true);
                    }
                  }}
                  placeholder="New task..."
                  showCursor={true}
                />
              </Box>
            )}

            {isDueInputMode && (
              <Box marginTop={1} flexDirection="column">
                <Box>
                  <Text color="yellow">Due: </Text>
                  <TextInput
                    value={dueInputValue}
                    onChange={setDueInputValue}
                    onSubmit={(value) => {
                      const dueAt = parseDueDate(value);
                      const newTodo: Todo = {
                        id: Date.now(),
                        text: pendingTodoText,
                        completed: false,
                        createdAt: new Date().toISOString(),
                        dueAt,
                      };
                      setTodos([...todos, newTodo]);
                      setDueInputValue('');
                      setPendingTodoText('');
                      setIsDueInputMode(false);
                      setSelectedIndex(todos.length);
                      const dueMsg = dueAt ? ` (${formatTime(dueAt)})` : '';
                      showMessage(`任务已添加${dueMsg}`);
                    }}
                    placeholder="30m/2h/3d/1w/tmr"
                    showCursor={true}
                  />
                </Box>
                <Text dimColor>格式: 30m, 2h, 3d, 1w, tmr, mon-fri, MM-DD</Text>
              </Box>
            )}
          </Box>

          {/* 简洁底部操作栏 */}
          <Box
            height={1}
            paddingLeft={1}
            backgroundColor="gray"
          >
            {isDueInputMode ? (
              <Text>Enter:save Esc:cancel | 30m 2h 3d 1w tmr mon-fri</Text>
            ) : isInputMode ? (
              <Text>Enter:next Esc:cancel</Text>
            ) : (
              <Text>jk:move space:toggle a:add d:del u:undo q:quit</Text>
            )}
          </Box>
        </Box>
      ) : (
        // 大窗口：双栏布局
        <Box flexDirection="row" flexGrow={1}>
          {/* 左侧任务列表 */}
          <Box
            flexDirection="column"
            width="70%"
            borderStyle="single"
            borderColor="gray"
            padding={1}
            overflow="hidden"
          >
            <Text bold underline color="cyan">
              任务列表 ({todos.length})
            </Text>

            <Box flexDirection="column" marginTop={1}>
              {todos.length === 0 ? (
                <Text dimColor>暂无任务，按 'a' 添加新任务</Text>
              ) : (
                todos.map((todo, index) => {
                  const isSelected = index === selectedIndex && !isInputMode && !isDueInputMode;
                  const maxTextWidth = Math.floor(dimensions.width * 0.5) - 15;
                  const displayText = truncateText(todo.text, maxTextWidth);
                  const hasDue = !!todo.dueAt;
                  const overdue = hasDue && isOverdue(todo.dueAt!);
                  const dueSoon = hasDue && isDueSoon(todo.dueAt!);

                  return (
                    <Box key={todo.id}>
                      <Box width="100%">
                        <Text color={isSelected ? 'cyan' : 'gray'}>
                          {isSelected ? '▸ ' : '  '}
                        </Text>
                        <Text color={todo.completed ? 'green' : 'yellow'}>
                          {todo.completed ? '✓' : '○'}
                        </Text>
                        <Text> </Text>
                        <Text
                          strikethrough={todo.completed}
                          color={todo.completed ? 'gray' : isSelected ? 'cyan' : 'white'}
                          bold={isSelected}
                          dimColor={todo.completed}
                        >
                          {displayText}
                        </Text>
                        {todo.completed && (
                          <Text color="green" dimColor>
                            {' '}[已完成]
                          </Text>
                        )}
                        {hasDue && !todo.completed && (
                          <Text color={overdue ? 'red' : dueSoon ? 'yellow' : 'gray'}>
                            {' '}[{formatTime(todo.dueAt!)}{overdue ? ' ⚠' : ''}]
                          </Text>
                        )}
                      </Box>
                    </Box>
                  );
                })
              )}
            </Box>

            {isInputMode && (
              <Box marginTop={1} borderStyle="single" borderColor="yellow" paddingX={1}>
                <TextInput
                  value={inputValue}
                  onChange={setInputValue}
                  onSubmit={(value) => {
                    if (value.trim()) {
                      setPendingTodoText(value.trim());
                      setInputValue('');
                      setIsInputMode(false);
                      setIsDueInputMode(true);
                    }
                  }}
                  placeholder="输入任务内容，按 Enter 继续..."
                  showCursor={true}
                />
              </Box>
            )}

            {isDueInputMode && (
              <Box marginTop={1} borderStyle="single" borderColor="magenta" paddingX={1} flexDirection="column">
                <Box>
                  <Text color="magenta">截止时间: </Text>
                  <TextInput
                    value={dueInputValue}
                    onChange={setDueInputValue}
                    onSubmit={(value) => {
                      const dueAt = parseDueDate(value);
                      const newTodo: Todo = {
                        id: Date.now(),
                        text: pendingTodoText,
                        completed: false,
                        createdAt: new Date().toISOString(),
                        dueAt,
                      };
                      setTodos([...todos, newTodo]);
                      setDueInputValue('');
                      setPendingTodoText('');
                      setIsDueInputMode(false);
                      setSelectedIndex(todos.length);
                      const dueMsg = dueAt ? ` (${formatTime(dueAt)})` : '';
                      showMessage(`任务已添加${dueMsg}`);
                    }}
                    placeholder="30m/2h/3d/1w/tmr/mon/03-20 (留空=无)"
                    showCursor={true}
                  />
                </Box>
              </Box>
            )}
          </Box>

          {/* 右侧信息面板 */}
          <Box
            flexDirection="column"
            width="30%"
            borderStyle="single"
            borderColor="gray"
            padding={1}
            overflow="hidden"
          >
            <Text bold underline color="magenta">
              统计
            </Text>

            <Box flexDirection="column" marginTop={1}>
              <Box>
                <Text color="yellow">总任务: </Text>
                <Text bold>{todos.length}</Text>
              </Box>
              <Box>
                <Text color="green">已完成: </Text>
                <Text bold color="green">{completedCount}</Text>
              </Box>
              <Box>
                <Text color="red">待处理: </Text>
                <Text bold color="red">{pendingCount}</Text>
              </Box>
            </Box>

            <Box marginTop={2}>
              <Text bold underline color="cyan">
                项目信息
              </Text>
            </Box>

            {projectInfo && (
              <Box flexDirection="column" marginTop={1}>
                <Box>
                  <Text dimColor>目录: </Text>
                  <Text wrap="end">{projectInfo.dir}</Text>
                </Box>
                <Box marginTop={1}>
                  <Text dimColor>分支: </Text>
                  <Text color={projectInfo.branch === 'nogit' ? 'gray' : 'green'}>
                    {projectInfo.branch === 'nogit' ? '未检测到' : projectInfo.branch}
                  </Text>
                </Box>
              </Box>
            )}

            <Box marginTop={2}>
              <Text bold underline color="cyan">
                操作
              </Text>
            </Box>

            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>↑↓/jk 选择</Text>
              <Text dimColor>h 顶部 l 底部</Text>
              <Text dimColor>空格 完成</Text>
              <Text dimColor>a 添加 d 删除</Text>
              <Text dimColor>u 撤回</Text>
              <Text dimColor>q/Esc 退出</Text>
            </Box>
          </Box>
        </Box>
      )}



      {/* IME 拼音预览预留区域 - 防止输入法导致界面跳动 */}
      <Box height={2} />
    </Box>
  );
};

render(<TodoList />, {
  kittyKeyboard: {
    mode: 'auto',
    flags: ['disambiguateEscapeCodes', 'reportEventTypes']
  }
});
