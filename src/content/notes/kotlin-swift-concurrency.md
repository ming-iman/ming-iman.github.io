---
title: "从挂起到页面状态：Kotlin 与 Swift 并发开发笔记"
description: "用八组移动端案例理解挂起、结构化并发、取消、错误传播、异步流、共享状态、搜索与页面生命周期。"
date: 2026-09-29
category: "移动端开发"
tags: [Kotlin, Swift, 协程, 并发, 学习笔记]
---

协程学习的难点，往往不在 `async` 或 `await` 怎么写，而在于四个问题：**谁创建工作，谁拥有生命周期，谁等待结果，以及谁能修改状态。**

这篇笔记用八组 Kotlin 与 Swift 对照案例，串起从基础挂起到移动端页面加载的完整路径。示例用延迟模拟请求；延迟数字用于说明执行关系，不是性能承诺。

## 01 · 挂起不等于并发

像点餐：先等汤上桌再点面，两段等待相加；先把两道菜都下单，等待才能重叠。

```kotlin
suspend fun loadSequentially(): Header {
    val name = fetchName()       // 约 120ms
    val unread = fetchUnread()   // 约 180ms
    return Header(name, unread)
}
```

```swift
func loadSequentially() async throws -> Header {
    let name = try await fetchName()
    let unread = try await fetchUnread()
    return Header(name: name, unread: unread)
}
```

两段代码都是顺序调用，总耗时通常接近 300ms 加运行开销。

**当前任务在等待，不代表执行线程也被阻塞。** 挂起时线程可以处理其他任务，但当前任务的下一行仍需等本次调用返回后执行。

| 意图 | Kotlin | Swift |
|---|---|---|
| 声明可挂起函数 | `suspend fun` | `func ... async` |
| 直接调用并等待 | 调用 suspend 函数 | `await`，抛错调用再加 `try` |
| 创建结构化子任务 | 作用域内 `async {}` | `async let` 或任务组 |
| 获取子任务结果 | `Deferred.await()` | `await` 子任务绑定或读取组结果 |

Kotlin `async {}` 是创建子协程的构建器；Swift 函数声明中的 `async` 标记函数具有异步能力，更接近 Kotlin 的 `suspend`。不要因为名字相同就把它们当成同一种操作。

## 02 · 结构化并发：工作要有人收尾

两个独立请求可以先启动，再等待。

```kotlin
suspend fun loadHeader(): Header = coroutineScope {
    val name = async { fetchName() }
    val unread = async { fetchUnread() }
    Header(name.await(), unread.await())
}
```

```swift
func loadHeader() async throws -> Header {
    async let name = fetchName()
    async let unread = fetchUnread()
    return try await Header(name: name, unread: unread)
}
```

```text
父作用域 ─┬─ 名字请求：120ms ─┐
          └─ 未读请求：180ms ─────┤ → 合并结果
```

等待名字时，未读请求已经可以推进。因此总耗时通常接近较慢请求的耗时，而不是两者之和。

Kotlin `coroutineScope` 是挂起函数，提供作用域并等待代码块及其子任务结束；它不是“切换后台线程”的指令。`fetchName` 只在调用它的协程中工作，所以不必再包一层作用域；并发版 `loadHeader` 则需要作用域来创建和管理子任务。

| Kotlin 工具 | 职责 | 返回值 |
|---|---|---|
| `coroutineScope` | 管理一组子任务，返回前等待它们结束 | 代码块结果 |
| `launch` | 启动不需要业务返回值的子协程 | `Job` |
| `async` | 启动有结果的子协程 | `Deferred<T>` |

`Deferred<T>` 是一种 `Job`，但 `Job` 不等于 `Deferred<Unit>`。`join()` 等待完成，不直接重抛目标任务的失败；`await()` 获取成功值或抛出目标错误。目标失败仍可能通过父子关系取消调用方，因此不能用 `join()` 隐藏失败。

Swift `Task {}` 是非结构化任务：普通函数返回、局部任务句柄消失，不会自动取消或等待它。`async let` 和任务组则有结构化生命周期。

## 03 · 取消是请求，不是强制终止

```text
发出取消 → 操作响应取消 → finally / defer 清理 → 任务结束
```

Kotlin 用 `job.cancelAndJoin()` 请求取消并等待；Swift 常见的显式管理方式是：

```swift
worker.cancel()
do {
    try await worker.value
} catch is CancellationError {
    // 当前操作因取消结束
}
```

`Task.sleep` 响应取消并抛错，`defer` 在离开作用域时执行。读取 `worker.value` 不会触发取消；它负责等待任务结束并观察结果或错误。

如果任务内部捕获取消异常且不重抛，任务可以正常返回；取消标记不会因此清除。对于可复用的异步函数，通常应在清理后继续传播取消，避免把停止意图变成成功结果并继续后续逻辑。

### 超时为何可能“超时了还没返回”

Swift 可以让工作任务与计时任务竞争：

```text
任务组 ─┬─ operation → 返回业务结果
        └─ sleep → 抛出超时错误
先完成的结果被读取 → 取消其余任务 → 等全部结束 → 返回或抛错
```

任务组退出前必须等待子任务结束。工作如果不配合取消，超时工具也不能保证在截止时刻立即返回。Kotlin 超时同样依赖合作式取消。

挂起 API 如 `delay`、`Task.sleep` 已支持取消。长时间 CPU 循环应主动检查：Kotlin 用 `ensureActive()`，Swift 用 `Task.checkCancellation()`。单纯把函数声明为 suspend 或 async，不会自动让任意计算可取消。

## 04 · 必要模块失败与可选模块降级

名字请求失败可能让主页无法展示；徽章失败可以换默认徽章。错误边界要由业务决定。

Kotlin 的普通 `coroutineScope` 中，子任务的非取消异常会使作用域失败并取消兄弟任务。`supervisorScope` 隔离直接子任务失败的影响，但不会替调用方吞异常。

```kotlin
suspend fun optionalBadge(): String = supervisorScope {
    val badge = async { brokenBadge() }
    try {
        badge.await()
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: IllegalStateException) {
        "默认徽章"
    }
}
```

如果换成 `coroutineScope`，内部 catch 即使执行，也不能恢复已经因子任务失败而失败的作用域。**捕获 await 抛出的错误，与阻止父子关系上的失败传播，是两件事。**

Swift throwing task group 的路径有所不同：

```text
子任务失败 → next() / for try await 获取失败并抛错
         → 错误离开组内代码块 → 取消其他子任务并等待退出
         → 外层 catch
```

`try` 表示这里可能抛错，`catch` 才是捕获。子任务失败本身不等于组立即失败；如何消费结果、错误是否逃出组内代码块非常重要。可选模块可以在自己的子任务内处理业务错误并返回默认值，同时保留取消传播。

## 05 · 从一个结果到一串结果

下载进度、搜索输入和定位更新都不是一次性返回值，而是一串随时间产生的数据。

```kotlin
fun progressFlow(): Flow<Int> = flow {
    for (progress in listOf(0, 25, 50, 75, 100)) {
        delay(20)
        emit(progress)
    }
}

// 在协程中收集
progressFlow()
    .filter { it >= 50 }
    .map { "下载进度 $it%" }
    .collect { println(it) }
```

`flow {}` 创建冷流：收集前，代码块中的 delay 和 emit 都不会执行；每次收集都会重新运行生产逻辑。工厂函数里 flow 块外的普通代码则会在调用时执行。

没有 buffer 等引入并发的操作符时，上游会等待当前下游处理完成，再继续生产。加 `buffer(2)` 后，生产与消费可以在不同协程推进，中间缓冲两个值。

| 满缓冲区策略 | 行为 |
|---|---|
| `SUSPEND`，默认 | 生产者等待空位 |
| `DROP_OLDEST` | 丢弃缓冲区最旧值，接纳新值 |
| `DROP_LATEST` | 丢弃新到值 |

Swift `AsyncStream` 的语义不能直接照搬冷 Flow。用 continuation 和独立 Task 构建时，生产者可以在消费前开始；`yield` 不通过挂起来等待慢消费者，要明确缓冲策略，并处理 yield 的结果（如数据被丢弃）。

```swift
continuation.onTermination = { @Sendable _ in
    producer.cancel()
}
```

终止处理可以把消费侧终止连接到生产者取消，但单纯 `break` 不应被视为立刻停止任意生产者的保证；还需考虑流的引用、消费者任务取消和显式停止。不要把同一个 AsyncStream 当作默认广播给所有订阅者的事件总线。

## 06 · 状态安全与业务原子性

`value += 1` 是读取、计算、写入三个动作。两个任务都读到 0，再各写回 1，会丢失一次更新。

```kotlin
class SafeCounter {
    private val mutex = Mutex()
    private var value = 0
    suspend fun increment() = mutex.withLock { value += 1 }
    suspend fun current(): Int = mutex.withLock { value }
}
```

整个读改写必须放在同一个临界区；读取和写入各自加锁，中间仍可能交错。等待所有任务完成也不能修复已经丢失的更新。

Swift actor 通过隔离管理自身状态：

```swift
actor SafeCounter {
    private var value = 0
    func increment() { value += 1 }
    func current() -> Int { value }
}
```

外部调用 `await counter.increment()` 可能要等待跨隔离调用，但 increment 内部没有挂起点，不会在加一的中间插入另一个 actor 隔离任务。actor 不等于专属线程，也不保证调用请求按提交顺序执行。

### actor 重入：await 后重新审视假设

余额检查和扣款之间如果有 await，就可能发生：

```text
余额 100
A 检查够取 80 → 挂起
B 检查也够取 80 → 挂起
A 恢复扣款 → 20
B 恢复扣款 → -60
```

没有同时修改内存的数据竞争，仍可能有业务竞态。简单修正是把检查和修改放在同一段不挂起的隔离代码中，或异步准备完成后重新检查最新状态。涉及真实外部支付副作用时，还需设计预留、幂等和补偿。

## 07 · 搜索：减少请求与避免旧结果覆盖

```kotlin
queries
    .distinctUntilChanged()
    .mapLatest { query -> search(query) }
```

`distinctUntilChanged` 去掉相邻重复输入；`mapLatest` 在新输入到来时取消尚未完成的旧转换。旧搜索已发送的结果不会被撤回，因此输入间隔足够长时，多个搜索结果都可能输出。

防抖与取消承担不同职责：

| 机制 | 解决的问题 |
|---|---|
| debounce | 等输入暂时稳定，减少请求数量 |
| mapLatest / 显式取消 | 请求过时时，停止旧工作 |
| 更新前检查取消或请求编号 | 拒绝过时结果修改页面 |

把 debounce 放在 mapLatest 前面，会推迟新输入到达 mapLatest；期间旧请求可能完成并输出。若要求键入瞬间旧结果就失效，应让原始输入立即使旧请求失效，再对新请求做防抖。有限模拟流正常结束时，debounce 会发送待处理末值，也不一定再等待完整防抖时长。

Swift 示例显式保存最新 Task，提交新查询时 cancel 旧 Task；加载后、写状态前调用 `Task.checkCancellation()`，防止忽略取消的底层返回过时结果。页面结束时也要管理这个非结构化任务。

## 08 · 页面状态与生命周期

```text
Idle → Loading ─┬─ Content(data)
                └─ Failure(message)
```

用一个可穷举的状态类型，比散落的多个布尔值更容易保持一致。Kotlin 用 sealed interface，Swift 用 enum 的关联值携带数据和错误。

Kotlin 的 `StateFlow` 保存当前状态，新订阅者拿到最新值，不会因重新订阅就自动发请求。它会合并更新，也基于相等性抑制重复值，因此不是保证每个中间事件都交付的日志。

新加载取消旧 Job；更新成功或失败状态前检查 `ensureActive()`。模型应明确主线程调用约定，不能把取消检查当作任意多线程下的原子事务。

Swift 可用 MainActor 隔离状态，再用请求编号防止乱序返回：

```swift
generation += 1
let ticket = generation
state = .loading

do {
    let header = try await loader()
    try Task.checkCancellation()
    guard ticket == generation else { return }
    state = .content(header)
} catch is CancellationError {
    // 页面离开不显示业务失败
} catch {
    guard !Task.isCancelled, ticket == generation else { return }
    state = .failure(String(describing: error))
}
```

编号必须同时保护成功与失败路径：新请求成功后，旧请求的错误同样不能覆盖页面。请求编号只拒绝过时更新，不会自动停止旧工作。

MainActor 管隔离，不自动提供 UI 观察。SwiftUI 还需要 Observation、ObservableObject 或显式更新 State；Android 使用生命周期感知的收集也不等于自动取消 ViewModel 内所有后台请求。

取消后的状态也要有业务定义：页面已经离开，可以不展示错误；页面仍可见且用户主动取消加载，则要恢复 Idle 或旧内容，而不是永久留在 Loading。

## 计时补充：不要把经过时间当作 CPU 时间

| 问题 | 工具或测量方式 |
|---|---|
| 现在是什么日期时间？ | `Date().timeIntervalSince1970` |
| 操作从开始到返回经过多久？ | Swift ContinuousClock / Kotlin measureTime |
| 进程实际消耗多少 CPU 时间？ | 平台 CPU 时间接口、性能分析工具 |
| 用户多久看到结果？ | 从交互开始测到实际界面呈现 |

系统时间校正可能影响 Date 差值；单调时钟适合测量 latency。ContinuousClock 包含等待和系统睡眠时间，不是 CPU 工作时间。跨设备的单调时间点不能直接相减。

首次运行可能包含类加载、运行时初始化和调度开销。测量时把打印放到计时外，在同一次运行中预热并重复观察。浏览器上传和编译等待不直接计入代码内部的 measureTime。一次 300ms 的结果不能单独证明两个请求串行，观察任务的开始和结束关系更直接。

## 把知识迁入真实页面

实现一个个人主页，可以按以下顺序验收：

1. 并发加载必需的数据，所有任务有明确拥有者。
2. 可选模块失败时降级，取消不被当成普通失败吞掉。
3. 离开页面后，根据业务决定取消哪些任务。
4. 快速刷新或搜索，旧成功和旧错误都不能覆盖最新状态。
5. 对成功、失败、取消、乱序完成分别验证；用可控信号安排顺序，避免只靠 sleep 猜测。
6. CPU 密集计算和阻塞 I/O 不占用 UI 执行资源；状态更新符合隔离规则。

最实用的自检不是“有没有写 await”，而是：**任务什么时候开始，谁能让它结束，结果属于哪次操作，状态更新前的假设还成立吗？**

## 官方参考

- [Kotlin 协程指南](https://kotlinlang.org/docs/coroutines-guide.html)
- [Kotlin 异步 Flow](https://kotlinlang.org/docs/flow.html)
- [Android 协程最佳实践](https://developer.android.com/kotlin/coroutines/coroutines-best-practices)
- [Swift Concurrency](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/)
- [Swift 结构化并发设计](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0304-structured-concurrency.md)
- [Swift actor 设计](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0306-actors.md)

示例范围：Kotlin/JVM + kotlinx.coroutines 及 Swift Concurrency。文中片段聚焦概念，部分依赖上下文中的类型、导入和调用环境；不是完整 App，也不替代平台生命周期与真实网络验证。
