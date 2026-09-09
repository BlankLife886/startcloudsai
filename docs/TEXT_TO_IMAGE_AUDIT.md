# 文生图完整链路审查

日期：2026-09-09。首次审查确认 8 类问题，其中 4 类优先级为 P1，4 类为 P2。用户随后授权修复，8 类问题的代码修改已完成。下方原始审查条目记录的是**修复前**的行为和复现证据，不代表当前版本仍有这些缺陷。

## 修复进展与对应验证

| 编号 | 当前实现 | 回归覆盖 |
| --- | --- | --- |
| T2I-01 | 固定批次各子项的请求、模型参数和幂等键，等待所有响应后只补交未接受子项；改价仅更新明确被拒绝子项的确认价格 | 两张部分接受后改价仍仅接受两张；丢失响应继续使用原键；补交不随页面切换模型 |
| T2I-02 | 普通取消不预先同意放弃退款；遇到已提交上游重新读取状态并二次确认；最终提示读取服务端保存的取消结果 | 提交与取消交叉、准确退款提示、较新的生成阶段不能覆盖旧退款弹窗的同意范围 |
| T2I-03 | 原图和缩略图的原始槽位单独持久化；对外输出列表保持兼容；兼容旧 Worker 文件名中的下标 | 第二张先保存、再次补取、旧数据恢复及失败清理后恢复均保留 A/B 顺序，按两张正确结算 |
| T2I-04 | 客户端业务参数和服务端可信执行参数分开；创建及报价都丢弃客户端注入的内部模型、路由等字段 | 私有模型内部 ID 注入不能改变实际请求模型，直接请求私有公开模型键被拒绝 |
| T2I-05 | 历史记录免计容量改用服务端拥有的标记；领取能处理异常完成时间戳；迁移 146 修整可确认的旧记录 | 伪造历史类型仍受容量限制且能超时恢复；异常及远未来完成标记不再卡住领取 |
| T2I-06 | 历史重新生成恢复原参考资源 key 和顺序；纯文生图清空参考；缺失资源提示处理 | A/B 参考图切换、无参考任务及失效历史参考图 |
| T2I-07 | 页面、草稿、列表和提交回调绑定用户身份；在真正发送请求及重试前再次检查身份 | 切换账号后丢弃旧响应；旧账号请求不能在新账号下补交、上传或取消 |
| T2I-08 | 完整解码前读取图片尺寸，普通图也按像素与处理缓冲区预约内存；涉及源画布的变换独占当前图片预算 | 4K 图头与极小压缩体积的组合仍预约像素预算，非法图头提前拒绝 |

最终验证：前端 48 项相关检查通过（任务并发与恢复 27、历史分页 4、媒体/计时/阶段/抠图关联/手持展示 17），Web 构建通过；服务端构建通过，`taskflow`、`store`、`httpapi`、`worker` 四个包的完整 `go test -race -p 1 -count=1` 回归全部通过，未发现数据竞争。

验证输出：[后端完整回归](/Users/ycc/Documents/TestCode/startcloudsai/.artifacts/t2i-fix-regression.log)、[前端任务回归](/Users/ycc/Documents/TestCode/startcloudsai/.artifacts/t2i-fix-frontend-final.log)、[前端构建](/Users/ycc/Documents/TestCode/startcloudsai/.artifacts/t2i-fix-web-build.log)。

本地服务于 2026-09-09 14:17 更新完成：API 和 Worker 使用修复后的新二进制，数据库迁移到 146；生图 Worker 与独立对话池均启动正常，数据库、Redis 和 API 健康检查通过，主站及后台返回 200。更新前确认无排队/执行中任务，并保存了[本地数据库备份](/Users/ycc/Documents/TestCode/startcloudsai/.artifacts/local-runtime/before-t2i-fix-hygiHB/database.dump)和旧二进制。没有发布线上，8144–8146 模拟通道保持关闭。

验收入口：[文生图](http://127.0.0.1:3105/text-to-image)、[管理后台](http://127.0.0.1:3200/admin/)。刷新页面后测试即可。

新增固定回归：[前端恢复测试](/Users/ycc/Documents/TestCode/startcloudsai/apps/web-react/scripts/test-t2i-recovery.mjs)、[后端完整性测试](/Users/ycc/Documents/TestCode/startcloudsai/apps/server/internal/worker/t2i_integrity_test.go)、[输入可信边界测试](/Users/ycc/Documents/TestCode/startcloudsai/apps/server/internal/taskflow/input_params_test.go)、[取消与实际结算测试](/Users/ycc/Documents/TestCode/startcloudsai/apps/server/internal/httpapi/task_cancel_policy_test.go)。

验证边界：使用独立临时数据库和本机模拟上游，没有调用收费模型或发布线上。前端身份切换检查为实际函数的隔离回归，未替代真实浏览器多账号验收；4K 检查验证内存预约规则，不是生产大图压力测试。待补交批次保存在当前页面会话，刷新后已接受任务从服务端历史恢复，不自动补交未接受图片。

## 原始审查记录（修复前）

审查覆盖：页面参数与报价、批次提交、幂等重试、身份切换、服务端输入与模型授权、冻结费用、排队准入、Worker 领取与恢复、C2A/CRUN 请求及轮询、图片下载与保存、部分交付结算、历史重新生成和取消反馈。

## P1：需要优先处理

### T2I-01 批次部分提交后改价，重新确认会重复生成和收费

位置：[TextToImageView.jsx](/Users/ycc/Documents/TestCode/startcloudsai/apps/web-react/src/views/TextToImageView.jsx:1413)、[useTextToImageJobs.js](/Users/ycc/Documents/TestCode/startcloudsai/apps/web-react/src/features/text-to-image/useTextToImageJobs.js:366)。

当前页面把多张图片拆成独立请求，使用 `Promise.all` 等待。第一张已创建，第二张遇到 `price_changed` 时，页面重新报价的数量仍是整批。用户确认后再次调用 `buildPayload`，每张生成新的幂等键，已经接受的第一张也被重新提交。

实际函数隔离复现：选择 2 张；第一张按 5 积分接受，第二张改价失败；确认 8 积分后又接受 2 张，最终接受 3 个不同幂等键任务，单价 `[5, 8, 8]`。

同一批次还有一个相关问题：第一个请求失败即退出 `Promise.all`，其余请求尚在执行时 `submitting` 已变为 false，允许继续触发提交。

修复方向：保存每个子任务固定的幂等身份和接受结果，等待所有子提交结束，只补交确定未接受的图片；或者使用后端事务创建整个批次。不能把部分成功当作整批未提交。

### T2I-02 取消弹窗承诺退款，但状态变化后实际可能扣费

位置：[TextToImageView.jsx](/Users/ycc/Documents/TestCode/startcloudsai/apps/web-react/src/views/TextToImageView.jsx:1856)。

排队/准备态弹窗告知冻结积分会退回，但 `confirmCancel` 无条件发送 `acknowledgeUpstream: true`。若用户打开弹窗后，Worker 刚好已经提交上游，服务端会认为用户确认了不退款停止，按预留积分结算。前端成功提示仍依据旧 `cancelTarget`，继续显示“冻结积分已退回”。

已执行当前弹窗与确认函数，复现退款承诺、请求中的 true、服务端不退款结果与错误成功提示的组合。服务端的二次确认门和提交后结算分支也已核对。

修复方向：仅在用户确实确认“不退款停止”的文案后传 true；普通取消先传 false，遇到确认要求时重新读取状态并提示。最终提示应使用服务端返回的实际取消政策和结果。

### T2I-03 单任务多图的补取恢复会丢失图片下标

位置：[task_outputs.go](/Users/ycc/Documents/TestCode/startcloudsai/apps/server/internal/worker/task_outputs.go:64)，相关保存位置在同文件第 245 行。

保存部分图片时，将带空槽的数组压缩后写入 `output_keys`；下一次恢复时，又直接把压缩数组复制到从 0 开始的槽位，丢失原图片下标。

使用真实 C2A 图片下载函数、临时数据库和模拟对象存储复现：

1. 一个服务端任务请求 A、B 两张不同图片。
2. 下载 A 时模拟 CDN 返回 503，B 下载成功，落库只剩 B 的 key。
3. 下次 A、B 均可获取；恢复后的收集器把已有 B 认作槽位 0，跳过 A，再把 B 存一次。
4. 最终两个不同对象 key 对应同一张 B，A 丢失。账务仍按 2 张成功结算，测试余额 100→90，冻结归零。

触发前提是**单个服务端 task 的 count 大于 1**。当前主站文生图批量通常拆成 count=1 的任务，因此不把它描述为所有主站批量都会触发；支持 count=2 等值的文生图 API/其他调用方仍受影响。

修复方向：持久化稳定的图片槽位或独立子项记录，恢复时按原 index 还原，不能用压缩后的列表顺序推断槽位。

### T2I-04 兼容回退路径可通过内部参数调用未公开模型

位置：[taskflow.go](/Users/ycc/Documents/TestCode/startcloudsai/apps/server/internal/taskflow/taskflow.go:538)，相关回退条件在第 694 行。

创建任务只过滤了三个恢复字段，仍接受客户端传入的 `_providerConfigId`、`_modelConfigId`。当没有公开图片模型、也没有当前工作区绑定时，创建流程允许使用遗留默认服务和默认价格，但后续执行快照却会信任这些内部 ID。

临时数据库与本机 HTTP 实测：配置一个未公开、定价 500 的图片模型，普通用户在 params 中带入其内部 ID，任务按默认 20 积分创建并冻结；随后实际 HTTP 请求中的 model 为该私有模型。

这是有配置前提的授权/价格绕过，不表示所有正常公开模型请求都能绕过。模型曾公开后改为私有时，旧任务记录可能已让用户获得这些 ID，因此不能靠 ID 难猜解决。

修复方向：外部请求与可信执行参数分开；模型/provider 身份只由服务端经过公开性、工作区授权和定价检查后写入。兼容回退不能保留客户端注入的配置绑定。

## P2：需要修复的状态、恢复与资源问题

### T2I-05 客户端内部执行标记可造成容量绕过或永久排队

位置：[taskflow.go](/Users/ycc/Documents/TestCode/startcloudsai/apps/server/internal/taskflow/taskflow.go:538)、[store/tasks.go](/Users/ycc/Documents/TestCode/startcloudsai/apps/server/internal/store/tasks.go:75)。

确认了两个同源表现：

- 传入 `_kind=ui-design-region-edit`，普通 t2i 任务会被部分 active 统计及过期恢复查询当作历史投影排除。测试把账户活跃任务/图片上限设为 1，仍接受两条任务；第一条领取后令租约过期，恢复扫描返回空，任务继续保持 running。
- 传入 `_completionClaimId` 与未来的 `_completionClaimedAtMs`，新任务已冻结 5 积分，但 `ClaimTask` 永远无法领取，返回空且没有等待原因。

修复方向：拒绝外部提供执行/恢复标记；历史投影排除采用服务端拥有的标记或独立类型。还需处理已存在的异常记录，不能只过滤以后新提交的参数。

### T2I-06 历史重新生成没有恢复原参考图

位置：[TextToImageView.jsx](/Users/ycc/Documents/TestCode/startcloudsai/apps/web-react/src/views/TextToImageView.jsx:1696)。

`applyTaskToInputs` 恢复提示词和部分选项，却没有恢复或清空 references；实际生成继续使用当前页面的参考图。

当前函数复现：历史任务使用参考图 A，当前左侧为 B，重新生成会发 B；当前为空时则变成纯文生图。

修复方向：恢复完整历史输入，包括稳定的参考资源 key；纯文生图明确清空当前参考图；原参考资源已不存在时提示用户处理，不能静默换图或去掉参考图。

### T2I-07 退出后旧异步请求可回填原账号任务

位置：[useTextToImageJobs.js](/Users/ycc/Documents/TestCode/startcloudsai/apps/web-react/src/features/text-to-image/useTextToImageJobs.js:208)，相关 effect 第 265 行。

列表请求只检查 `mountedRef`。认证改变会先把它设为 false，随后新 effect 又设为 true；旧账号请求返回后仍能写入状态。hook 也只接收 authenticated，不区分用户 ID。

按实际 hook 及 effect 清理/重建顺序复现：登录 A 发起慢列表请求→退出并清空→旧响应返回→未登录状态的 tasks 中再次出现 A 的私有提示词。当前导航栏退出只清用户状态，不强制跳转；文生图工作区也没有按账号 key 重建。生成区域仍会消费任务状态。

已确认客户端状态回填，未声称后端发生跨账号越权；前端探针使用 React 状态替身，不是浏览器跨账号端到端测试。

修复方向：按用户 ID/request generation 绑定请求与回调，身份变化取消列表请求并校验旧回调，不仅检查组件是否 mounted。

### T2I-08 普通大图的内存预约按压缩体积计算，严重低估解码占用

位置：[task_outputs.go](/Users/ycc/Documents/TestCode/startcloudsai/apps/server/internal/worker/task_outputs.go:164)。

普通输出只按压缩文件大小的 6 倍预约内存，最低 1 MiB；只有 strictAlphaOutput 分支按解码尺寸估算。原图与缩略/展示图处理还会并行执行。

保存阶段探针实测：4096×4096 RGBA PNG 的压缩文件为 75,656 字节，解码像素本身为 64 MiB，但在 128 MiB 图片预算中只占用了至多 1 MiB，剩余 127 MiB 仍可被获取。

已确认预算低估，多图并发时存在内存峰值失控、Worker 重启风险；**没有触发或证明生产 OOM**。该探针后续编码/上传还遇到测试上下文超时，没有把它算作另一项生产故障，也不把此次执行算作正常 4K 出图成功。

修复方向：所有图片在完整解码前读取尺寸，按像素及实际处理缓冲区估算；使用现有 `media.Base64Dimensions` 等能力，不只对透明图使用尺寸预算。

## 证据与验证结果

| 检查 | 本轮结果 |
| --- | --- |
| 前端实际函数隔离探针 | 5/5 成功复现，对应 4 类缺陷；这里 PASS 表示缺陷存在 |
| 后端 Go overlay 探针 | 4 个期望安全行为的断言失败，复现私有模型、内部标记及回图问题 |
| 内存预算探针 | 断言失败，证实压缩体积不能代表解码预算；未做生产 OOM 验证 |
| 既有 C2A、CRUN、taskflow、worker 完整回归 | `go test -race` 通过 |
| 既有前端任务/历史相关回归 | 19 项通过 |
| 总耗时展示检查 | 通过 |

既有测试通过与这次发现不矛盾：新增探针覆盖了批次部分接受后重新报价、取消弹窗与提交交叉、内部参数注入、图片下载部分失败后再次保存等组合边界。

前端证据：[详细报告](/Users/ycc/Documents/TestCode/startcloudsai/.artifacts/t2i-frontend-audit-2026-09-09.md)、[复现脚本](/Users/ycc/Documents/TestCode/startcloudsai/.artifacts/t2i-frontend-audit-2026-09-09.mjs)。

后端证据：[探针源码](/Users/ycc/Documents/TestCode/startcloudsai/.artifacts/t2i-audit.fX9QIl/backend_probes_test.go)、[功能/安全复现输出](/Users/ycc/Documents/TestCode/startcloudsai/.artifacts/t2i-audit.fX9QIl/backend-probes-final.log)、[内存探针输出](/Users/ycc/Documents/TestCode/startcloudsai/.artifacts/t2i-audit.fX9QIl/memory-probe.log)。

复现命令（后端运行于 `apps/server`，只创建独立临时测试库）：

```sh
# 前端原始探针：修复前成功退出表示成功复现缺陷，不作为修复后的通过标准。
node --test .artifacts/t2i-frontend-audit-2026-09-09.mjs

# 后端原始探针：修复前这些断言失败，用于证明缺陷；保留为历史证据。
TEST_DATABASE_URL=postgres://localhost:5432/postgres GOMAXPROCS=2 GIN_MODE=release \
go test -overlay /Users/ycc/Documents/TestCode/startcloudsai/.artifacts/t2i-audit.fX9QIl/overlay.json \
  -race -p 1 -count=1 -v -timeout 180s ./internal/worker -run '^TestT2IAudit'
```

Go overlay 将 artifact 中的探针临时映射进 worker 测试包，没有改动真实业务源码，也没有把失败测试写进正常测试目录。原始回归输出同样保存在 `.artifacts/t2i-audit.fX9QIl/`。

首次审查没有使用真实供应商、真实用户素材或线上服务器。正常任务执行与冻结/结算主路径的已有修复继续保留，模拟控制台没有重新开启。后续修复与验证情况见本文开头。
