---
title: "Kotlin 与 Swift 并发开发笔记"
description: "整理 Kotlin 与 Swift 的挂起、任务生命周期、取消、错误处理、异步流与状态管理，以及页面加载和搜索中的常见问题。"
date: 2026-09-29
updated: 2026-10-08
category: "移动端开发"
tags: [Kotlin, Swift, 协程, 并发, 学习笔记]
---

Kotlin 和 Swift 都能用顺序代码表达异步操作，但任务的创建、取消和错误传播并不完全相同。写并发代码时，需要明确任务由谁持有、何时结束，以及返回的结果是否仍然有效。

以下代码省略了部分类型定义和导入，重点说明执行顺序和状态变化。延迟用于模拟请求，不代表实际网络耗时。

## 挂起与并发

挂起会暂停当前任务，让线程有机会执行其他工作。当前任务仍按代码顺序执行：一次调用没有返回，下一行就不会开始。

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

如果两个请求分别等待 120ms 和 180ms，这两种写法的总耗时都接近 300ms，加上运行开销。

要让独立请求重叠执行，需要先创建子任务，再等待结果：

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

等待名字时，未读请求已经开始。总耗时通常接近较慢请求的耗时。按顺序读取结果不会使已经启动的任务变成串行；创建一个任务后立即等待，再创建下一个，才会失去这部分并发。

| 操作 | Kotlin | Swift |
|---|---|---|
| 声明可挂起函数 | `suspend fun` | `func ... async` |
| 调用并等待 | 直接调用挂起函数 | `await`；可能抛错时加 `try` |
| 创建结构化子任务 | 作用域内 `async {}` | `async let`、任务组 |
| 读取结果 | `Deferred.await()` | 等待 async let 绑定、读取任务组结果 |

Kotlin 的 `async {}` 会创建子协程。Swift 函数声明中的 `async` 只表示函数可以挂起，更接近 Kotlin 的 `suspend`。两者都不保证函数在后台线程执行，也不会自动把阻塞调用变成非阻塞调用。

## 任务的生命周期

结构化并发把子任务的生命周期限制在父作用域内。作用域退出前，要等子任务结束，包括取消后的清理。

Kotlin 的 `coroutineScope` 是挂起函数：它提供创建子任务的作用域，等待代码块和子任务完成，再返回结果。它不负责切换调度器。只调用一个挂起接口的函数通常不需要额外包一层；需要创建并发子任务时，才需要这样的作用域。

| Kotlin API | 用途 | 返回值 |
|---|---|---|
| `coroutineScope` | 管理一组子任务并等待结束 | 代码块结果 |
| `launch` | 启动不返回业务数据的任务 | `Job` |
| `async` | 启动需要结果的任务 | `Deferred<T>` |

`Deferred<T>` 继承 `Job`，但 `Job` 不等于 `Deferred<Unit>`：

- `join()` 等待结束，不直接重抛目标任务的失败原因。
- `await()` 等待结果，返回值或抛出目标任务的异常。
- 子任务失败仍可能通过父子关系取消等待者；换成 `join()` 并不能隔离失败。

Swift 的 `async let` 和任务组有结构化生命周期。`Task {}` 是非结构化任务，普通函数返回或局部句柄消失，不会自动取消它。页面自己创建的 Task，需要明确保存句柄、取消和等待的位置。

## 取消与清理

取消需要任务配合。发出取消请求、任务停止、清理完成，是不同的时刻。

```text
请求取消 → 任务响应取消 → finally / defer 清理 → 任务结束
```

Kotlin 的 `job.cancel()` 只请求取消；`job.cancelAndJoin()` 请求取消并挂起等待结束。Swift 可以显式取消后等待：

```swift
worker.cancel()
do {
    try await worker.value
} catch is CancellationError {
    // 任务已因取消结束
}
```

这里假设 worker 是可抛错的 Task。读取 `value` 不会触发取消，它负责等待和观察结果；`Task<Void, Never>` 的 value 无需 `try`。

等待也有边界：Kotlin 的 join 可以响应等待者自身的取消；目标任务不配合取消时，cancelAndJoin 不保证立即返回。结构化作用域已负责退出前等待子任务，通常不需要再逐个手动 join。

### 检查状态，还是中断执行

| 操作 | 行为 |
|---|---|
| Kotlin `isActive` | 返回布尔值，由代码决定是否继续 |
| Kotlin `ensureActive()` | 已取消时抛出 `CancellationException` |
| Swift `Task.isCancelled` | 返回当前任务是否已取消 |
| Swift `try Task.checkCancellation()` | 已取消时抛出 `CancellationError` |

```kotlin
if (isActive) {
    updateState()
}
performNextStep() // 条件不成立时，仍会执行
```

如果后续工作也必须停止，应在前面调用 `ensureActive()`，并让取消异常继续传播。Swift 的 `checkCancellation()` 可能抛错，所以要加 `try`；它不挂起，因此不需要 `await`。

这些检查只反映当前时刻的状态，不是锁，也不能保证检查后任务不会再被取消。`delay` 和 `Task.sleep` 支持取消；长时间 CPU 循环则需要主动检查。

### 取消异常与取消标志

异常类型和任务状态要分别考虑。任务可能已经取消，底层接口却抛出普通错误。可恢复错误的处理分支中，也可以再检查取消，避免误返回默认值。

Kotlin 中，已经取消的 Job 不会因吞掉异常恢复正常。但如果内部操作只是主动抛出 `CancellationException`，外层捕获后不重抛，外层 Job 可能正常完成。因此可复用的挂起函数通常应继续传播取消。

Swift 中，已经设置的取消标志不会因 catch 后返回而清除；单纯抛出 `CancellationError` 也不一定设置外层任务的取消标志。

### 超时不保证按时返回

超时通常通过取消正在执行的操作来实现。Swift 可以让操作和计时任务在任务组内竞争，读取先完成的结果后，取消其他任务并等待它们退出。

如果操作不配合取消，任务组仍要等待它结束。Kotlin 超时也依赖协作式取消。因此超时时间到了，不代表调用已经完成清理并返回。

## 错误传播与局部降级

先确定哪些数据必需，哪些失败后可以用默认值。以个人主页为例：名字失败时整体失败，头像失败显示默认图，未读数失败显示占位。

### Kotlin：在可选子任务内部处理失败

普通 `coroutineScope` 中，子任务的非取消异常会导致作用域失败，并取消兄弟任务。`supervisorScope` 隔离直接子任务失败的影响，但不会自动处理异常。即使使用 supervisor，代码块自身向外抛错时，仍会取消剩余子任务并等待退出。

如果只需要局部降级，可以在可选子任务内部把普通失败转换为值：

```kotlin
suspend fun loadProfile(service: ProfileService): Profile = coroutineScope {
    val name = async { service.name() }
    val avatar = async {
        try {
            service.avatar()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            currentCoroutineContext().ensureActive()
            DEFAULT_AVATAR
        }
    }
    val unread = async {
        try {
            service.unread()
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            currentCoroutineContext().ensureActive()
            null
        }
    }
    Profile(name.await(), avatar.await(), unread.await())
}
```

name 失败时，由作用域取消其他任务；可选请求的普通错误已经在各自任务内处理，不会使整个作用域失败。这里无需额外使用 `supervisorScope`，也无需由 name 手动取消其他任务。

如果让可选子任务先以异常结束，再在普通作用域中 catch 它的 await，作用域可能已经被取消。捕获 await 的错误不能恢复已经失败的作用域。

上面的代码对普通 `Exception` 统一降级。实际项目应明确可恢复的错误类型，避免隐藏程序错误。测试也不应只用 `error(...)`：它抛出 `IllegalStateException`，不足以覆盖 `IOException` 等接口异常。

### Swift：错误在等待结果时传播

三个固定请求可以用 `async let`，降级逻辑放在辅助函数中：

```swift
private func loadAvatar(_ service: ProfileService) async throws -> String {
    do {
        return try await service.avatar()
    } catch is CancellationError {
        throw CancellationError()
    } catch {
        try Task.checkCancellation()
        return defaultAvatar
    }
}

private func loadUnread(_ service: ProfileService) async throws -> Int? {
    do {
        return try await service.unread()
    } catch is CancellationError {
        throw CancellationError()
    } catch {
        try Task.checkCancellation()
        return nil
    }
}

func loadProfile(_ service: ProfileService) async throws -> Profile {
    async let name = service.name()
    async let avatar = loadAvatar(service)
    async let unread = loadUnread(service)
    return try await Profile(name: name, avatar: avatar, unread: unread)
}
```

`Profile` 的初始化是同步的，这里的 `try await` 用于读取子任务结果。name 失败后，父任务在等待 name 时观察到错误；错误导致函数退出作用域，Swift 才会取消尚未完成的兄弟任务并等待它们结束。子任务失败和整个作用域退出不是同一时刻。参见 [async let 的错误传播规则](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0317-async-let.md)。

throwing task group 也是通过 `next()` 或 `for try await` 观察子任务的错误。错误离开组内代码块时，剩余任务被取消；在组内处理错误后继续消费结果，则有不同的执行路径。

两个辅助函数先识别 `CancellationError`，再在普通错误分支检查当前任务状态。Kotlin 示例中的 `ensureActive()` 作用相同，都用于避免取消被误处理为降级。

### launch 的异常在哪里处理

业务异常可以在 launch 内捕获并转换成页面状态。未捕获的普通异常则按父子关系传播：普通 Job 通常会随子任务失败而取消，SupervisorJob 隔离直接子任务的失败，但仍需要处理未捕获异常。最终异常可能交给 `CoroutineExceptionHandler` 或平台的未捕获异常处理机制。参见 [Kotlin 异常处理规则](https://kotlinlang.org/docs/exception-handling.html)。

调用 `refresh()` 的同步代码外面套 try/catch，不能捕获另一个协程体中的异步失败。`join()` 也不负责读取该失败；`Deferred.await()` 才会返回目标结果或抛出异常。

`CancellationException` 被协程机制视为取消，不会仅因子任务取消就让父作用域失败。取消仍然可以通过挂起调用向上传播，通常保留这种传播，清理放在 finally 中。

## 异步数据流

一次请求返回一个结果。进度、输入和定位则会持续产生值，需要流来表达。

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

`flow {}` 创建冷流。收集前，代码块里的 delay 和 emit 不执行；每次收集都会重新运行。flow 块外的普通代码仍会在工厂函数调用时执行。

默认顺序收集时，上游等下游处理完当前值，再继续生产。`buffer(2)` 允许生产和消费在不同协程推进，中间缓冲两个值。

| 缓冲区满时的策略 | 行为 |
|---|---|
| `SUSPEND`，默认 | 生产者等待空位 |
| `DROP_OLDEST` | 丢弃最旧值，接纳新值 |
| `DROP_LATEST` | 丢弃新到值 |

Swift `AsyncStream` 不等同于冷 Flow。用 continuation 和独立 Task 构建时，生产者可以在消费前开始；`yield` 不通过挂起来等待慢消费者。需要选择缓冲策略，并处理值被丢弃等结果。

```swift
continuation.onTermination = { @Sendable _ in
    producer.cancel()
}
```

这个处理把流的终止连接到生产者取消。仅从循环 break，不保证任意生产者立即停止，还要考虑流的引用和显式关闭。AsyncStream 也不是默认向多个订阅者广播的事件总线。

## 共享状态与原子性

`value += 1` 包含读取、计算、写入。两个任务都读到 0，再各写回 1，就会丢失一次更新。

```kotlin
class SafeCounter {
    private val mutex = Mutex()
    private var value = 0
    suspend fun increment() = mutex.withLock { value += 1 }
    suspend fun current(): Int = mutex.withLock { value }
}
```

完整的读改写要放在同一个临界区。读取和写入分别加锁，中间仍然可能交错。

Swift actor 通过隔离管理状态：

```swift
actor SafeCounter {
    private var value = 0
    func increment() { value += 1 }
    func current() -> Int { value }
}
```

外部通常通过 `await counter.increment()` 跨隔离调用。increment 内没有挂起点，加一过程不会被另一个 actor 隔离任务插入。actor 不等于专属线程，也不保证请求按提交顺序执行。

### await 会改变原先的条件

余额检查与扣款之间如果有 await，另一个任务可能在等待期间修改余额：

```text
余额 100
A 检查够取 80 → 挂起
B 检查也够取 80 → 挂起
A 恢复扣款 → 20
B 恢复扣款 → -60
```

这段代码可以没有数据竞争，却仍有业务竞态。简单的检查与修改应放在同一段不挂起的隔离代码内；必须异步准备时，返回后重新检查状态。涉及外部交易时，还需要预留、幂等或补偿等业务设计。

## 页面状态与生命周期

用状态类型表达页面当前显示什么：

```text
Idle → Loading → Content / Failure
```

Kotlin 可用 sealed interface，Swift 可用带关联值的 enum。Kotlin `StateFlow` 保存最新状态，按相等性抑制重复值，也可能合并中间更新；它适合表示当前状态，不适合当作保证逐条交付的事件日志。重新订阅 StateFlow 本身不会自动发起请求。

### 防止旧结果覆盖新状态

刷新时取消旧任务、增加请求编号，并记录本次 ticket。请求返回后，只有未取消且编号仍匹配的任务可以写状态。普通错误也要经过相同检查，否则旧错误可能覆盖新内容。

以下代码位于 Kotlin 的 launch 任务体内：

```kotlin
try {
    val profile = loader()
    ensureActive()
    if (ticket == pageVersion) {
        page.value = ViewState.Content(profile)
    }
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (failure: Exception) {
    ensureActive()
    if (ticket == pageVersion) {
        page.value = ViewState.Failure(failure.message ?: "加载失败，请重试")
    }
}
```

这里约定状态与请求句柄都在同一个 UI 线程管理，检查到写入之间没有挂起点。取消检查不能代替任意多线程下的同步。

Swift 的状态和编号可以由 MainActor 隔离。await 返回后也要检查取消和编号：MainActor 保证访问隔离，不保证旧请求先返回。

### 在哪里结束取消传播

数据函数通常继续向外抛错；页面任务可以把普通错误转换成状态，并在任务边界结束取消路径。两种接口有不同约定：

| 接口 | 处理方式 |
|---|---|
| Kotlin `launch` | 业务错误转为状态，取消异常重新抛出，保留 Job 的取消语义 |
| Swift `async throws` 数据函数 | 向调用者传播错误，包括取消 |
| Swift `Task<Void, Never>` 页面任务 | 内部处理错误，取消时结束任务体 |
| Swift `Task<Void, Error>` | 可通过 `try await task.value` 读取错误 |

`Task<Void, Never>` 表示任务没有业务返回值，也不向外抛错。在它的任务体中重新抛出未处理的取消异常，会与声明的类型不匹配。可以在 catch 中直接 return；这不会清除已经设置的取消标志。

页面离开时要取消自己持有的任务。若页面仍可见、用户只是停止加载，则应恢复 Idle 或旧内容，避免一直显示 Loading。

### 状态隔离不等于 UI 更新

MainActor 不会自动让普通属性驱动 SwiftUI，还需要 Observation、ObservableObject 或显式更新 State。Android 的生命周期感知收集停止后，也不等于 ViewModel 里已经启动的请求被取消。

任务归属要按页面行为选择：ViewModel 的任务可以跨临时不可见状态继续运行；只允许在可见期间运行的工作，则应放进对应的生命周期作用域。同步 CPU 重活和阻塞 I/O 也不能仅靠 suspend、async 或 MainActor 解决，需要合适的调度器或执行方式。

## 搜索防抖与过期结果

防抖减少请求次数；取消停止旧工作；请求编号防止旧结果回写。这三件事不能互相替代。

新输入到来时，先取消旧任务并使旧编号失效，再处理新输入。空字符串恢复 Idle；非空输入等待一段时间后请求。

```text
输入变化 → 旧任务失效
新任务 → 防抖等待 → 检查取消 → 请求 → 检查取消和编号 → 写状态
```

Kotlin 可以用 Flow 处理连续输入：

```kotlin
queries
    .distinctUntilChanged()
    .mapLatest { query -> search(query) }
```

`distinctUntilChanged` 去掉相邻重复输入，`mapLatest` 在新输入到来时取消旧转换。已经发出的结果不会撤回。若 debounce 放在 mapLatest 前，新输入还在防抖时，旧请求可能继续返回结果。要求输入一变化旧结果就失效时，应先让旧请求失效，再对新请求等待。

有限流结束时，debounce 会发出待处理的末值，不一定再等完整防抖时间。

Swift 可以保存并替换当前搜索 Task。下面的任务体假设 query 已经 trim，旧任务已取消，ticket 已分配；debounce 是注入的等待函数，默认等待 300ms：

```swift
let task = Task { @MainActor in
    guard !normalized.isEmpty else { return }
    do {
        try await debounce()
        try Task.checkCancellation()

        let result = try await loader(normalized)
        try Task.checkCancellation()
        guard ticket == searchVersion else { return }
        searchState = .content(result)
    } catch is CancellationError {
        return
    } catch {
        guard !Task.isCancelled, ticket == searchVersion else { return }
        searchState = .failure(String(describing: error))
    }
}
```

防抖后的检查阻止旧任务发起请求，请求后的检查阻止旧结果写入。默认 Task.sleep 支持取消，但注入的等待函数或第三方接口未必配合，因此两处都检查。

`guard !normalized.isEmpty` 是布尔判断；`guard let` 用于 Optional 绑定。Kotlin 的 delay 可以放在 try/catch 外自然传播取消；Swift 的 `Task<Void, Never>` 则需要在内部处理可抛错的 debounce 调用。

## 验证并发行为

测试要控制执行顺序，不能只看最终结果或真实耗时。

| 要验证的行为 | 测试方式 |
|---|---|
| 请求确实并发 | Kotlin 用虚拟时间；Swift 用可控信号，确认所有请求启动后再放行 |
| 可选失败正确降级 | 覆盖不同普通错误类型，并单独验证取消 |
| 取消后完成清理 | 检查 finally / defer，以及任务结果或取消状态 |
| 旧结果不能覆盖 | 让旧请求忽略取消，分别晚成功、晚失败 |
| 防抖只发最后一次请求 | 在等待窗口内连续输入，记录实际调用 |
| 空输入、关闭与重新进入 | 检查清空状态、停止在途工作和再次加载 |

测试超时用于防止卡死，不是接口性能标准。逻辑测试通过后，仍要在 App 中验证导航离开、后台切换、UI 更新与卡顿情况。

## 计时：经过时间与 CPU 时间

| 测量目标 | 工具 |
|---|---|
| 当前日期时间 | `Date().timeIntervalSince1970` |
| 操作从开始到返回的耗时 | Swift `ContinuousClock`、Kotlin `measureTime` |
| 实际 CPU 消耗 | 平台 CPU 时间接口或性能分析工具 |
| 用户等待时间 | 从交互开始测到实际界面呈现 |

系统校时可能影响 Date 差值。测量 latency 应使用单调时钟。ContinuousClock 包含等待和系统睡眠时间，不能用来直接代表 CPU 工作时间；不同设备的单调时间点也不能直接相减。

首次运行可能包含类加载、初始化和调度开销。测量时移出打印、预热并重复观察。判断是否并发时，记录请求的开始与结束关系，比单次总耗时更可靠。

## 参考资料

- [Kotlin 协程指南](https://kotlinlang.org/docs/coroutines-guide.html)
- [Kotlin 异常处理](https://kotlinlang.org/docs/exception-handling.html)
- [Kotlin Flow](https://kotlinlang.org/docs/flow.html)
- [Android 协程最佳实践](https://developer.android.com/kotlin/coroutines/coroutines-best-practices)
- [Swift Concurrency](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/)
- [Swift 结构化并发](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0304-structured-concurrency.md)
- [Swift async let](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0317-async-let.md)
- [Swift actor](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0306-actors.md)
