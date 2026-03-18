import React, { useState, useEffect, useMemo } from 'react';
import { render, Text, Box, useInput, useApp, useStdout, useStdin, Static } from 'ink';
import TextInput from 'ink-text-input';
import { loadCache, saveCache, getProjectInfo, type Todo } from './cache.js';
import { parseDueDate, formatTime, isOverdue, isDueSoon, extractTags, extractPriority, removeTags, getAllTags, matchesSearch } from './utils.js';

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

  // 搜索功能
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // 编辑功能
  const [isEditMode, setIsEditMode] = useState(false);
  const [isEditDueMode, setIsEditDueMode] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [editDueValue, setEditDueValue] = useState('');
  const [editingTodoId, setEditingTodoId] = useState<number | null>(null);

  // 标签过滤
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [showTagSelector, setShowTagSelector] = useState(false);
  const [tagSelectorIndex, setTagSelectorIndex] = useState(0);

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

  // 过滤后的任务列表
  const filteredTodos = useMemo(() => {
    let result = [...todos];
    
    // 应用搜索过滤
    if (searchQuery) {
      result = result.filter(todo => matchesSearch(todo, searchQuery));
    }
    
    // 应用标签过滤
    if (tagFilter) {
      result = result.filter(todo => {
        const tags = extractTags(todo.text);
        return tags.includes(tagFilter.toLowerCase());
      });
    }
    
    return result;
  }, [todos, searchQuery, tagFilter]);

  // 保存任务时提取标签和优先级
  const processNewTodo = (text: string, dueAt?: string): Todo => {
    const { priority } = extractPriority(text);
    const tags = extractTags(text);
    
    return {
      id: Date.now(),
      text,
      completed: false,
      createdAt: new Date().toISOString(),
      dueAt,
      tags,
      priority,
    };
  };

  useInput((input, key) => {
    // 标签选择器模式
    if (showTagSelector) {
      const allTags = getAllTags(todos);
      if (key.escape) {
        setShowTagSelector(false);
        setTagSelectorIndex(0);
      } else if (key.upArrow || input === 'k') {
        setTagSelectorIndex(Math.max(0, tagSelectorIndex - 1));
      } else if (key.downArrow || input === 'j') {
        setTagSelectorIndex(Math.min(allTags.length - 1, tagSelectorIndex + 1));
      } else if (key.return) {
        if (allTags[tagSelectorIndex]) {
          setTagFilter(allTags[tagSelectorIndex]);
          setSelectedIndex(0);
          showMessage(`按标签过滤: #${allTags[tagSelectorIndex]}`);
        }
        setShowTagSelector(false);
        setTagSelectorIndex(0);
      } else if (input === 'c') {
        setTagFilter(null);
        setShowTagSelector(false);
        setTagSelectorIndex(0);
        showMessage('已清除标签过滤');
      }
      return;
    }

    // 编辑截止时间模式
    if (isEditDueMode) {
      if (key.escape) {
        setIsEditDueMode(false);
        setEditDueValue('');
        setEditingTodoId(null);
        showMessage('取消编辑');
      } else if (key.return) {
        const dueAt = parseDueDate(editDueValue);
        setTodos(todos.map(t => 
          t.id === editingTodoId 
            ? { ...t, dueAt }
            : t
        ));
        setIsEditDueMode(false);
        setEditDueValue('');
        setEditingTodoId(null);
        const dueMsg = dueAt ? ` (${formatTime(dueAt)})` : '';
        showMessage(`任务已更新${dueMsg}`);
      }
      return;
    }

    // 编辑模式
    if (isEditMode) {
      if (key.escape) {
        setIsEditMode(false);
        setEditValue('');
        setEditingTodoId(null);
        showMessage('取消编辑');
      } else if (key.return) {
        if (editValue.trim()) {
          const { priority } = extractPriority(editValue.trim());
          const tags = extractTags(editValue.trim());
          setTodos(todos.map(t => 
            t.id === editingTodoId 
              ? { ...t, text: editValue.trim(), priority, tags }
              : t
          ));
          setEditValue('');
          setEditingTodoId(null);
          setIsEditMode(false);
          showMessage('任务已更新');
        }
      }
      return;
    }

    // 搜索模式
    if (isSearchMode) {
      if (key.escape) {
        setIsSearchMode(false);
        setSearchQuery('');
        setSelectedIndex(0);
        showMessage('退出搜索');
      } else if (key.return) {
        setIsSearchMode(false);
        if (searchQuery) {
          showMessage(`搜索: ${searchQuery}`);
        }
      }
      return;
    }

    // 截止时间输入模式
    if (isDueInputMode) {
      if (key.escape) {
        setIsDueInputMode(false);
        setDueInputValue('');
        setPendingTodoText('');
        showMessage('取消添加');
      } else if (key.return) {
        const dueAt = parseDueDate(dueInputValue);
        const newTodo = processNewTodo(pendingTodoText, dueAt);
        setTodos([...todos, newTodo]);
        setDueInputValue('');
        setPendingTodoText('');
        setIsDueInputMode(false);
        setSelectedIndex(filteredTodos.length);
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

    // 搜索功能 (/)
    if (input === '/') {
      setIsSearchMode(true);
      setSearchQuery('');
      return;
    }

    // 标签选择器 (t)
    if (input === 't') {
      const allTags = getAllTags(todos);
      if (allTags.length > 0) {
        setShowTagSelector(true);
        setTagSelectorIndex(0);
      } else {
        showMessage('没有可用的标签');
      }
      return;
    }

    // 清除过滤 (c)
    if (input === 'c') {
      if (tagFilter || searchQuery) {
        setTagFilter(null);
        setSearchQuery('');
        setSelectedIndex(0);
        showMessage('已清除所有过滤');
      }
      return;
    }

    // 编辑任务 (e)
    if (input === 'e') {
      const currentTodo = filteredTodos[selectedIndex];
      if (currentTodo) {
        setEditingTodoId(currentTodo.id);
        setEditValue(currentTodo.text);
        setIsEditMode(true);
      }
      return;
    }

    // 编辑截止时间 (E)
    if (input === 'E') {
      const currentTodo = filteredTodos[selectedIndex];
      if (currentTodo) {
        setEditingTodoId(currentTodo.id);
        setEditDueValue(currentTodo.dueAt ? formatTime(currentTodo.dueAt) : '');
        setIsEditDueMode(true);
      }
      return;
    }

    // 删除任务 (d) - 可撤回
    if (input === 'd') {
      const todo = filteredTodos[selectedIndex];
      if (todo) {
        const originalIndex = todos.findIndex(t => t.id === todo.id);
        setDeletedStack(prev => [...prev, { todo, index: originalIndex }]);
        setTodos(todos.filter(t => t.id !== todo.id));
        if (selectedIndex >= filteredTodos.length - 1) {
          setSelectedIndex(Math.max(0, filteredTodos.length - 2));
        }
        showMessage(`已删除: ${todo.text} (按 u 撤回)`);
      }
      return;
    }

    // 撤回删除 (u)
    if (input === 'u') {
      if (deletedStack.length > 0) {
        const lastDeleted = deletedStack[deletedStack.length - 1];
        if (lastDeleted) {
          const newTodos = [...todos];
          newTodos.splice(lastDeleted.index, 0, lastDeleted.todo);
          setTodos(newTodos);
          setDeletedStack(prev => prev.slice(0, -1));
          setSelectedIndex(Math.min(lastDeleted.index, filteredTodos.length - 1));
          showMessage(`已撤回: ${lastDeleted.todo.text}`);
        }
      } else {
        showMessage('没有可撤回的操作');
      }
      return;
    }

    if (input === ' ') {
      const currentTodo = filteredTodos[selectedIndex];
      if (currentTodo) {
        setTodos(todos.map(t => 
          t.id === currentTodo.id 
            ? { ...t, completed: !t.completed }
            : t
        ));
        const status = !currentTodo.completed ? '完成' : '未完成';
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
      setSelectedIndex(Math.min(filteredTodos.length - 1, selectedIndex + 1));
      return;
    }

    // vim 风格: h 向上滚动（可选，这里用于跳转到第一项）
    if (input === 'h') {
      setSelectedIndex(0);
      return;
    }

    // vim 风格: l 向下滚动（可选，这里用于跳转到最后一项）
    if (input === 'l') {
      setSelectedIndex(Math.max(0, filteredTodos.length - 1));
      return;
    }
  });

  const completedCount = todos.filter(t => t.completed).length;
  const pendingCount = todos.length - completedCount;
  const overdueCount = todos.filter(t => !t.completed && t.dueAt && isOverdue(t.dueAt)).length;
  const filteredCompletedCount = filteredTodos.filter(t => t.completed).length;
  const filteredPendingCount = filteredTodos.length - filteredCompletedCount;

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
              <Text color="gray"> ({filteredTodos.length}/{todos.length}) </Text>
              <Text color="gray">-</Text>
              <Text color="green"> {filteredCompletedCount} done</Text>
              {tagFilter && (
                <>
                  <Text color="gray"> | </Text>
                  <Text color="magenta">#{tagFilter}</Text>
                </>
              )}
              {searchQuery && (
                <>
                  <Text color="gray"> | </Text>
                  <Text color="yellow">/{searchQuery}</Text>
                </>
              )}
            </Box>

            {/* 标签选择器 */}
            {showTagSelector && (
              <Box 
                flexDirection="column" 
                borderStyle="single" 
                borderColor="cyan" 
                padding={1}
                marginBottom={1}
              >
                <Text bold color="cyan">选择标签过滤:</Text>
                {getAllTags(todos).map((tag, idx) => (
                  <Box key={tag}>
                    <Text color={idx === tagSelectorIndex ? 'cyan' : 'white'}>
                      {idx === tagSelectorIndex ? '> ' : '  '}
                      #{tag}
                    </Text>
                  </Box>
                ))}
                <Text dimColor>按 Enter 选择, c 清除过滤, Esc 取消</Text>
              </Box>
            )}

            <Box flexDirection="column">
              {filteredTodos.length === 0 ? (
                <Text dimColor>
                  {todos.length === 0 ? "Press 'a' to add task" : "没有匹配的任务"}
                </Text>
              ) : (
                filteredTodos.map((todo, index) => {
                  const isSelected = index === selectedIndex && !isInputMode && !isEditMode;
                  const displayText = truncateText(removeTags(todo.text), dimensions.width - 20);
                  const hasDue = !!todo.dueAt;
                  const overdue = hasDue && isOverdue(todo.dueAt!);
                  const dueSoon = hasDue && isDueSoon(todo.dueAt!);
                  const tags = extractTags(todo.text);
                  const priorityColor = todo.priority === 'high' ? 'red' : todo.priority === 'medium' ? 'yellow' : 'gray';

                  return (
                    <Box key={todo.id}>
                      <Box width="100%">
                        <Text color={isSelected ? 'cyan' : 'gray'}>
                          {isSelected ? '> ' : '  '}
                        </Text>
                        <Text color={todo.completed ? 'green' : 'white'}>
                          {todo.completed ? '[x] ' : '[ ] '}
                        </Text>
                        {todo.priority && (
                          <Text color={priorityColor}>{todo.priority === 'high' ? '!' : todo.priority === 'medium' ? '‼' : '·'} </Text>
                        )}
                        <Text
                          strikethrough={todo.completed}
                          color={todo.completed ? 'gray' : 'white'}
                        >
                          {displayText}
                        </Text>
                        {tags.length > 0 && (
                          <Text color="cyan">
                            {' '}{tags.map(t => `#${t}`).join(' ')}
                          </Text>
                        )}
                        {hasDue && !todo.completed && (
                          <Text color={overdue ? 'red' : dueSoon ? 'yellow' : 'gray'}>
                            {' '}[{formatTime(todo.dueAt!)}]
                          </Text>
                        )}
                      </Box>
                    </Box>
                  );
                })
              )}
            </Box>

            {/* 搜索输入框 */}
            {isSearchMode && (
              <Box marginTop={1} borderStyle="single" borderColor="yellow" paddingX={1}>
                <Text color="yellow">/ </Text>
                <TextInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  onSubmit={() => {
                    setIsSearchMode(false);
                    if (searchQuery) {
                      showMessage(`搜索: ${searchQuery}`);
                    }
                  }}
                  placeholder="搜索任务或标签..."
                  showCursor={true}
                />
              </Box>
            )}

            {/* 编辑输入框 */}
            {isEditMode && (
              <Box marginTop={1} borderStyle="single" borderColor="green" paddingX={1}>
                <Text color="green">Edit: </Text>
                <TextInput
                  value={editValue}
                  onChange={setEditValue}
                  onSubmit={(value) => {
                    if (value.trim()) {
                      const { priority } = extractPriority(value.trim());
                      const tags = extractTags(value.trim());
                      setTodos(todos.map(t => 
                        t.id === editingTodoId 
                          ? { ...t, text: value.trim(), priority, tags }
                          : t
                      ));
                      setEditValue('');
                      setEditingTodoId(null);
                      setIsEditMode(false);
                      showMessage('任务已更新');
                    }
                  }}
                  placeholder="编辑任务..."
                  showCursor={true}
                />
              </Box>
            )}

            {/* 编辑截止时间输入框 */}
            {isEditDueMode && (
              <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1}>
                <Box>
                  <Text color="magenta">Edit Due: </Text>
                  <TextInput
                    value={editDueValue}
                    onChange={setEditDueValue}
                    onSubmit={(value) => {
                      const dueAt = parseDueDate(value);
                      setTodos(todos.map(t => 
                        t.id === editingTodoId 
                          ? { ...t, dueAt }
                          : t
                      ));
                      setIsEditDueMode(false);
                      setEditDueValue('');
                      setEditingTodoId(null);
                      const dueMsg = dueAt ? ` (${formatTime(dueAt)})` : '';
                      showMessage(`截止时间已更新${dueMsg}`);
                    }}
                    placeholder="30m/2h/3d/1w/tmr"
                    showCursor={true}
                  />
                </Box>
                <Text dimColor>格式: 30m, 2h, 3d, 1w, tmr, mon-fri, MM-DD</Text>
              </Box>
            )}

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
                      const newTodo = processNewTodo(pendingTodoText, dueAt);
                      setTodos([...todos, newTodo]);
                      setDueInputValue('');
                      setPendingTodoText('');
                      setIsDueInputMode(false);
                      setSelectedIndex(filteredTodos.length);
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
            ) : isEditDueMode ? (
              <Text>Enter:save Esc:cancel | 30m 2h 3d 1w tmr</Text>
            ) : isSearchMode ? (
              <Text>Enter:search Esc:cancel</Text>
            ) : isEditMode ? (
              <Text>Enter:save Esc:cancel | !high !medium !low #tag</Text>
            ) : isInputMode ? (
              <Text>Enter:next Esc:cancel</Text>
            ) : showTagSelector ? (
              <Text>Enter:select jk:move c:clear Esc:cancel</Text>
            ) : (
              <Text>jk:move /:search t:tag e:edit space:toggle a:add d:del q:quit</Text>
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
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold underline color="cyan">
                任务列表 ({filteredTodos.length}/{todos.length})
              </Text>
              {(tagFilter || searchQuery) && (
                <Box>
                  {tagFilter && (
                    <Text color="magenta">#{tagFilter} </Text>
                  )}
                  {searchQuery && (
                    <Text color="yellow">/{searchQuery}</Text>
                  )}
                </Box>
              )}
            </Box>

            {/* 标签选择器 */}
            {showTagSelector && (
              <Box 
                flexDirection="column" 
                borderStyle="single" 
                borderColor="cyan" 
                padding={1}
                marginTop={1}
              >
                <Text bold color="cyan">选择标签过滤:</Text>
                {getAllTags(todos).map((tag, idx) => (
                  <Box key={tag}>
                    <Text color={idx === tagSelectorIndex ? 'cyan' : 'white'} bold={idx === tagSelectorIndex}>
                      {idx === tagSelectorIndex ? '▸ ' : '  '}
                      #{tag}
                    </Text>
                  </Box>
                ))}
                <Box marginTop={1}><Text dimColor>按 Enter 选择, c 清除过滤, Esc 取消</Text></Box>
              </Box>
            )}

            <Box flexDirection="column" marginTop={1}>
              {filteredTodos.length === 0 ? (
                <Text dimColor>
                  {todos.length === 0 ? "暂无任务，按 'a' 添加新任务" : "没有匹配的任务"}
                </Text>
              ) : (
                filteredTodos.map((todo, index) => {
                  const isSelected = index === selectedIndex && !isInputMode && !isDueInputMode && !isEditMode && !isEditDueMode && !showTagSelector;
                  const maxTextWidth = Math.floor(dimensions.width * 0.5) - 20;
                  const displayText = truncateText(removeTags(todo.text), maxTextWidth);
                  const hasDue = !!todo.dueAt;
                  const overdue = hasDue && isOverdue(todo.dueAt!);
                  const dueSoon = hasDue && isDueSoon(todo.dueAt!);
                  const tags = extractTags(todo.text);
                  const priorityColor = todo.priority === 'high' ? 'red' : todo.priority === 'medium' ? 'yellow' : 'gray';

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
                        {todo.priority && (
                          <Text color={priorityColor}>
                            {todo.priority === 'high' ? '!' : todo.priority === 'medium' ? '‼' : '·'}
                          </Text>
                        )}
                        <Text> </Text>
                        <Text
                          strikethrough={todo.completed}
                          color={todo.completed ? 'gray' : isSelected ? 'cyan' : 'white'}
                          bold={isSelected}
                          dimColor={todo.completed}
                        >
                          {displayText}
                        </Text>
                        {tags.length > 0 && (
                          <Text color="cyan">
                            {' '}{tags.map(t => `#${t}`).join(' ')}
                          </Text>
                        )}
                        {todo.completed && (
                          <Text color="green" dimColor>
                            {' '}[已完成]
                          </Text>
                        )}
                        {hasDue && !todo.completed && (
                          <Text color={overdue ? 'red' : dueSoon ? 'yellow' : 'gray'}>
                            {' '}[{formatTime(todo.dueAt!)}]
                          </Text>
                        )}
                      </Box>
                    </Box>
                  );
                })
              )}
            </Box>

            {/* 搜索输入框 */}
            {isSearchMode && (
              <Box marginTop={1} borderStyle="single" borderColor="yellow" paddingX={1}>
                <Text color="yellow">搜索: </Text>
                <TextInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  onSubmit={() => {
                    setIsSearchMode(false);
                    if (searchQuery) {
                      showMessage(`搜索: ${searchQuery}`);
                    }
                  }}
                  placeholder="搜索任务或标签..."
                  showCursor={true}
                />
              </Box>
            )}

            {/* 编辑输入框 */}
            {isEditMode && (
              <Box marginTop={1} borderStyle="single" borderColor="green" paddingX={1}>
                <Text color="green">编辑任务: </Text>
                <TextInput
                  value={editValue}
                  onChange={setEditValue}
                  onSubmit={(value) => {
                    if (value.trim()) {
                      const { priority } = extractPriority(value.trim());
                      const tags = extractTags(value.trim());
                      setTodos(todos.map(t => 
                        t.id === editingTodoId 
                          ? { ...t, text: value.trim(), priority, tags }
                          : t
                      ));
                      setEditValue('');
                      setEditingTodoId(null);
                      setIsEditMode(false);
                      showMessage('任务已更新');
                    }
                  }}
                  placeholder="编辑任务内容..."
                  showCursor={true}
                />
              </Box>
            )}

            {/* 编辑截止时间输入框 */}
            {isEditDueMode && (
              <Box marginTop={1} borderStyle="single" borderColor="magenta" paddingX={1} flexDirection="column">
                <Box>
                  <Text color="magenta">编辑截止时间: </Text>
                  <TextInput
                    value={editDueValue}
                    onChange={setEditDueValue}
                    onSubmit={(value) => {
                      const dueAt = parseDueDate(value);
                      setTodos(todos.map(t => 
                        t.id === editingTodoId 
                          ? { ...t, dueAt }
                          : t
                      ));
                      setIsEditDueMode(false);
                      setEditDueValue('');
                      setEditingTodoId(null);
                      const dueMsg = dueAt ? ` (${formatTime(dueAt)})` : '';
                      showMessage(`截止时间已更新${dueMsg}`);
                    }}
                    placeholder="30m/2h/3d/1w/tmr/mon/03-20 (留空=清除)"
                    showCursor={true}
                  />
                </Box>
              </Box>
            )}

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
                      const newTodo = processNewTodo(pendingTodoText, dueAt);
                      setTodos([...todos, newTodo]);
                      setDueInputValue('');
                      setPendingTodoText('');
                      setIsDueInputMode(false);
                      setSelectedIndex(filteredTodos.length);
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
              <Box>
                <Text color="red">已超时: </Text>
                <Text bold color="red">{overdueCount}</Text>
              </Box>
              <Box>
                <Text color="cyan">标签数: </Text>
                <Text bold color="cyan">{getAllTags(todos).length}</Text>
              </Box>
            </Box>

            {/* 标签列表 */}
            {getAllTags(todos).length > 0 && (
              <>
                <Box marginTop={2}>
                  <Text bold underline color="cyan">
                    标签
                  </Text>
                </Box>
                <Box flexDirection="column" marginTop={1}>
                  {getAllTags(todos).slice(0, 8).map(tag => (
                    <Box key={tag}>
                      <Text color={tagFilter === tag ? 'magenta' : 'cyan'}>
                        {tagFilter === tag ? '▸ ' : '  '}#{tag}
                      </Text>
                    </Box>
                  ))}
                  {getAllTags(todos).length > 8 && (
                    <Text dimColor>... 还有 {getAllTags(todos).length - 8} 个</Text>
                  )}
                </Box>
              </>
            )}

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
              <Text dimColor>e 编辑 E 改时间</Text>
              <Text dimColor>/ 搜索 t 标签</Text>
              <Text dimColor>c 清除过滤</Text>
              <Text dimColor>u 撤回</Text>
              <Text dimColor>q/Esc 退出</Text>
            </Box>
          </Box>
        </Box>
      )}



      {/* 消息提示 */}
      {message && (
        <Box 
          height={1} 
          paddingLeft={1}
          backgroundColor="yellow"
        >
          <Text color="black" bold>{message}</Text>
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
