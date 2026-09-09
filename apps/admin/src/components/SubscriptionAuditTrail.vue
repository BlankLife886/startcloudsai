<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {useRouter} from 'vue-router';
import {Refresh} from '@element-plus/icons-vue';
import {request,isRequestAborted} from '@/request';
import {billingMoney,type AccountingSummary} from '@/billingTypes';
import {formatTime} from '@/utils';

interface AuditData {
 orderId:string;asOf:string;user:{id:string;username:string;email:string};
 subscription:{id:string;planName:string;status:string;startsAt:string;endsAt:string};
 credits:{granted:number;available:number;frozen:number;held:number;spent:number;expired:number;upgradeReclaimed:number;refundReclaimed:number;currentSpent:number|null;priorSpent:number|null};
 finance:AccountingSummary;accountFinance:AccountingSummary;
 calculation:{maxRefundCents:number;timeValueCents:number;unusedValueCents:number;protectedUsagePoints:number;protectedTopupFrozenPoints:number;futurePoints:number;rule:string}|null;
 calculationError:string;
 records:{items:Record<string,any>[];page:number;limit:number;total:number};
}
const props=defineProps<{orderId:string;revision:number}>();
const emit=defineEmits<{'ready':[ready:boolean]}>();
const router=useRouter(),data=ref<AuditData|null>(null),section=ref('payments'),page=ref(1),loading=ref(false),error=ref('');
let controller:AbortController|undefined;
const remainingValue=computed(()=>data.value?.subscription.status==='cancelled' ? 0 : data.value?.calculation ? Math.max(0,Math.min(data.value.calculation.timeValueCents,data.value.calculation.unusedValueCents,data.value.finance.receivedCents-data.value.finance.refundedCents)) : null);
const labels:Record<string,string>={pending:'待支付',quoted:'报价未下单',uncertain:'待核实',paid:'收款待到账',completed:'已完成',cancelled:'已取消',expired:'已过期',failed:'失败',reviewing:'退款审核中',processing:'待渠道退款确认',rejected:'已驳回',active:'生效中',refunding:'退订处理中',subscription:'订阅开通',upgrade:'订阅升级',refund:'退订退款',initial:'开通发放',cycle:'周期重置',legacy:'历史记录',requested:'提交申请',approve:'审核通过',reject:'驳回申请',manual_approved:'人工核定',confirm_external_refund:'记录渠道退款成功',callback:'支付回调',reconcile:'订单对账',change:'订阅处理',task:'创作任务',sandbox_subscription_usage:'测试模拟消费',assistant:'AI助手'};
const label=(value:string)=>({order_removed:'订单移除',removed:'移除失效订单'}[value]||labels[value]||value||'未记录');
const points=(value:number|null|undefined)=>value==null?'未记录':`${value.toLocaleString('zh-CN')} 积分`;
const orderLink=(id:string)=>router.resolve({path:'/orders',query:{orderId:id,search:id}}).href;
const changeLink=(id:string)=>router.resolve({path:'/subscription-changes',query:{search:id}}).href;
const userLink=computed(()=>data.value?router.resolve({path:'/users',query:{userId:data.value.user.id,search:data.value.user.email}}).href:'');
const accountOrdersLink=computed(()=>data.value?router.resolve({path:'/orders',query:{userId:data.value.user.id}}).href:'');
async function load(){
 controller?.abort();const own=new AbortController();controller=own;loading.value=true;error.value='';emit('ready',false);
 try{
  const next=await request<AuditData>(`/api/v1/admin/orders/${encodeURIComponent(props.orderId)}/subscription-audit`,{query:{section:section.value,page:page.value},signal:own.signal,silent:true});
  if(own.signal.aborted)return;
  if(next.orderId!==props.orderId || !next.records || !Array.isArray(next.records.items) || !next.credits || !next.finance || !next.accountFinance || !next.user?.id || !next.subscription?.id)throw new Error('账务链路返回不完整，请重新核查');
  data.value=next;emit('ready',true);
 }catch(e){if(!own.signal.aborted&&!isRequestAborted(e))error.value=e instanceof Error?e.message:'账务链路读取失败'}
 finally{if(controller===own)loading.value=false}
}
watch(()=>[props.orderId,props.revision],()=>{section.value='payments';page.value=1;data.value=null;load()},{immediate:true});
onBeforeUnmount(()=>{controller?.abort();emit('ready',false)});
function changeSection(){page.value=1;if(data.value)data.value.records={items:[],page:1,limit:20,total:0};load()}
</script>

<template>
 <section class="subscription-audit" aria-label="用户订阅账务链路" v-loading="loading">
  <header class="subscription-audit__head"><strong>用户订阅账务链路</strong><el-button :icon="Refresh" :loading="loading" size="small" @click="load">刷新链路</el-button></header>
  <el-alert v-if="error" type="error" :closable="false" :title="error" />
  <template v-if="data && !error">
   <div class="subscription-audit__identity"><div><b>{{ data.user.username }}</b> · {{ data.user.email }}<small>{{ data.subscription.planName }} · {{ label(data.subscription.status) }} · {{ formatTime(data.subscription.startsAt) }} 至 {{ formatTime(data.subscription.endsAt) }}</small></div><nav><a :href="userLink" target="_blank" rel="noopener">用户全部账务</a><a :href="accountOrdersLink" target="_blank" rel="noopener">用户全部订单</a></nav></div>
   <div class="subscription-audit__stats">
    <div><span>本订阅确认实收</span><b>{{ billingMoney(data.finance.receivedCents) }}</b></div>
    <div><span>本订阅已退</span><b>{{ billingMoney(data.finance.refundedCents) }}</b></div>
    <div><span>自助退款额度</span><b>{{ billingMoney(data.calculation?.maxRefundCents) }}</b></div>
    <div><span>剩余权益参考值</span><b>{{ billingMoney(remainingValue) }}</b></div>
   </div>
   <p class="subscription-audit__note">参考值来自剩余服务时间和未消耗权益的核算，不等于自动可退金额；已使用积分时，人工退款需另行核定。</p>
   <el-alert v-if="data.credits.spent || data.calculation?.protectedUsagePoints" type="warning" :closable="false" :title="`已有权益消费：订阅积分 ${data.credits.spent}，价格保护下结算 ${data.calculation?.protectedUsagePoints || 0} 积分。两者可能重叠，不能相加扣款；未用完新套餐不代表整条订阅没有消费。`" />
   <el-alert v-if="data.credits.frozen || data.calculation?.protectedTopupFrozenPoints" type="error" :closable="false" title="仍有订阅或锁价充值积分用于进行中任务，须等待结算后核定退款。" />
   <el-alert v-if="data.calculationError" type="warning" :closable="false" :title="data.calculationError" />
   <dl class="subscription-audit__credits">
    <div><dt>历史发放</dt><dd>{{ points(data.credits.granted) }}</dd></div>
    <div><dt>历史消费</dt><dd>{{ points(data.credits.spent) }}</dd></div>
    <div><dt>当前整期消费</dt><dd>{{ points(data.credits.currentSpent) }}</dd></div>
    <div><dt>升级前消费</dt><dd>{{ points(data.credits.priorSpent) }}</dd></div>
    <div><dt>当前可用 / 任务冻结</dt><dd>{{ data.credits.available }} / {{ data.credits.frozen }}</dd></div>
    <div><dt>变更冻结</dt><dd>{{ points(data.credits.held) }}</dd></div>
    <div><dt>升级回收 / 到期失效</dt><dd>{{ data.credits.upgradeReclaimed }} / {{ data.credits.expired }}</dd></div>
    <div><dt>退订回收</dt><dd>{{ points(data.credits.refundReclaimed) }}</dd></div>
   </dl>
   <el-tabs v-model="section" @tab-change="changeSection">
    <el-tab-pane label="付款与升级" name="payments" /><el-tab-pane label="积分批次" name="lots" /><el-tab-pane label="实际消费" name="usage" /><el-tab-pane label="升级与退款记录" name="changes" /><el-tab-pane label="处理日志" name="events" />
   </el-tabs>
   <el-table v-if="section==='payments'" :data="data.records.items" size="small" max-height="340" empty-text="暂无关联付款">
    <el-table-column label="套餐 / 订单" min-width="260"><template #default="{row}"><strong>{{ row.sourcePlanName ? `${row.sourcePlanName} → ` : '' }}{{ row.planName }}</strong><small>{{ label(row.kind) }} · 权益版本 {{ row.revision }} · 每天 {{ row.dailyPoints }} 积分 / {{ row.durationDays }} 天</small><a :href="orderLink(row.id)" target="_blank" rel="noopener">{{ row.id }}</a></template></el-table-column>
    <el-table-column label="金额" width="150"><template #default="{row}">实收 {{ billingMoney(row.receivedCents) }}<small>订单 {{ billingMoney(row.amountCents) }}</small><small v-if="row.credit">抵扣 {{ billingMoney(row.credit.creditCents) }}<br>目标原价 {{ billingMoney(row.targetPriceCents) }}</small></template></el-table-column>
    <el-table-column label="状态 / 渠道" min-width="200"><template #default="{row}">{{ label(row.status) }} · {{ row.method==='alipay'?'支付宝':row.method==='wechat'?'微信':row.method || '未记录' }}<small>{{ row.providerOrderId || '未记录渠道单号' }}</small><small v-if="row.removedAt">列表移除记录 {{ formatTime(row.removedAt) }}</small></template></el-table-column>
    <el-table-column label="创建 / 支付 / 生效" min-width="185"><template #default="{row}">{{ formatTime(row.createdAt) }}<small>支付 {{ formatTime(row.paidAt) }}</small><small>生效 {{ formatTime(row.startsAt) }}</small></template></el-table-column>
   </el-table>
   <el-table v-else-if="section==='lots'" :data="data.records.items" size="small" max-height="340" empty-text="暂无积分批次">
    <el-table-column label="发放来源" min-width="240"><template #default="{row}">{{ row.planName }}<small>{{ row.currentTerm?'当前整期':row.termKnown?'历史周期':'周期未记录' }} · {{ label(row.kind) }} · {{ formatTime(row.createdAt) }}</small><a :href="orderLink(row.orderId)" target="_blank" rel="noopener">{{ row.orderId }}</a><small>批次 {{ row.id }}</small></template></el-table-column>
    <el-table-column prop="granted" label="发放" width="75" /><el-table-column prop="spent" label="消费" width="75" /><el-table-column prop="available" label="可用" width="75" />
    <el-table-column label="冻结" width="130"><template #default="{row}">任务 {{ row.frozen }}<small>变更 {{ row.held }} {{ row.holdReason==='refund'?'退订':row.holdReason==='upgrade'?'升级':'' }}</small></template></el-table-column>
    <el-table-column label="非消费回收" min-width="150"><template #default="{row}">升级 {{ row.upgradeReclaimed }}<small>到期 {{ row.expired }} · 退订 {{ row.refundReclaimed }}</small></template></el-table-column>
    <el-table-column label="到期" min-width="170"><template #default="{row}">{{ formatTime(row.expiresAt) }}</template></el-table-column>
   </el-table>
   <el-table v-else-if="section==='usage'" :data="data.records.items" size="small" max-height="340" empty-text="暂无消费或冻结记录">
    <el-table-column type="expand"><template #default="{row}"><div class="subscription-audit__expanded"><p>业务记录：{{ row.sourceType }} / {{ row.sourceId }}</p><p v-if="row.task">任务 {{ row.task.id }} · {{ row.task.type }} · {{ label(row.task.status) }}</p><p v-if="row.task">{{ row.task.prompt }}</p><p>已释放 {{ row.released }} 积分；释放后到期 {{ row.expired }} 积分，均不计为消费。</p><p>订阅消费归属：本轮 {{ row.currentSpent ?? '未记录' }}，之前 {{ row.priorSpent ?? '未记录' }}。其余资金来源可在用户全部账务中核对。</p><p v-if="row.subscriptionSpent!=null && row.subscriptionSpent>(row.currentSpent||0)+(row.priorSpent||0)">另有 {{ row.subscriptionSpent-(row.currentSpent||0)-(row.priorSpent||0) }} 积分缺少周期归属。</p><p v-if="row.subscriptionSpent==null">历史记录未保存逐笔结算金额，不能当作零消费，请结合积分批次累计核查。</p><p v-if="row.priceBookId">价格记录 {{ row.priceBookId }} · 本次单价 {{ row.unitPoints }} / 公示单价 {{ row.publicUnitPoints }} 积分</p></div></template></el-table-column>
    <el-table-column label="消费或冻结事项" min-width="280"><template #default="{row}">{{ row.reason || label(row.sourceType) }}<small>{{ row.sourceType }} · {{ row.sourceId }}</small><small>{{ row.createdAt?formatTime(row.createdAt):'发生时间未记录' }}</small></template></el-table-column>
    <el-table-column label="订阅实际消费" width="130"><template #default="{row}">{{ row.subscriptionSpent ?? '历史未记录' }}</template></el-table-column><el-table-column prop="topupSpent" label="充值批次消费" width="130" />
    <el-table-column label="未结算冻结" width="160"><template #default="{row}">订阅 {{ row.subscriptionFrozen }}<small>充值 {{ row.topupFrozen }}</small></template></el-table-column>
   </el-table>
   <el-table v-else-if="section==='changes'" :data="data.records.items" size="small" max-height="340" empty-text="暂无变更记录">
    <el-table-column label="变更" min-width="260"><template #default="{row}">{{ row.manual?'人工例外退款':label(row.kind) }} · {{ label(row.status) }}<small>{{ row.sourcePlanName ? `${row.sourcePlanName} → ` : '' }}{{ row.planName }}</small><a v-if="row.status!=='quoted'" :href="changeLink(row.id)" target="_blank" rel="noopener">{{ row.id }}</a><small v-else>{{ row.id }}</small></template></el-table-column>
    <el-table-column label="金额 / 抵扣" width="145"><template #default="{row}">{{ billingMoney(row.amountCents) }}<small v-if="row.credit">抵扣 {{ billingMoney(row.credit.creditCents) }}</small><small v-if="row.kind==='refund'">{{ row.status==='completed'?'已确认退款':'尚未确认退款' }}</small></template></el-table-column>
    <el-table-column label="处理依据" min-width="250"><template #default="{row}">{{ row.reason || '—' }}<small>{{ row.reviewNote || '暂无审核记录' }}</small><small v-if="row.reference">退款流水 {{ row.reference }}</small></template></el-table-column>
    <el-table-column label="时间 / 操作人" min-width="185"><template #default="{row}">{{ formatTime(row.createdAt) }}<small>{{ row.actor || '用户 / 系统' }}</small><small v-if="row.completedAt">完成 {{ formatTime(row.completedAt) }}</small></template></el-table-column>
   </el-table>
   <el-table v-else :data="data.records.items" size="small" max-height="340" empty-text="暂无处理日志">
    <el-table-column label="发生时间" width="170"><template #default="{row}">{{ formatTime(row.createdAt) }}</template></el-table-column>
    <el-table-column label="来源 / 处理" width="180"><template #default="{row}">{{ label(row.kind) }}<small>{{ label(row.action) }}</small><small v-if="row.verified!=null">{{ row.verified?'验签通过':'验签未通过' }}</small></template></el-table-column>
    <el-table-column label="说明与关联记录" min-width="350"><template #default="{row}">{{ row.detail || row.publicMessage || '—' }}<small>{{ row.publicMessage }}</small><a v-if="row.orderId" :href="orderLink(row.orderId)" target="_blank" rel="noopener">{{ row.orderId }}</a><a v-if="row.changeId" :href="changeLink(row.changeId)" target="_blank" rel="noopener">变更 {{ row.changeId }}</a></template></el-table-column>
    <el-table-column label="金额 / 操作人" width="160"><template #default="{row}">{{ row.kind==='order_removed'?'不涉及资金':billingMoney(row.amountCents) }}<small>{{ row.actor }}</small></template></el-table-column>
   </el-table>
   <el-pagination :current-page="page" :page-size="data.records.limit" :total="data.records.total" layout="total, prev, pager, next" @current-change="value=>{page=value;load()}" />
   <p class="subscription-audit__note">用户全部订单实收 {{ billingMoney(data.accountFinance.receivedCents) }}，已退 {{ billingMoney(data.accountFinance.refundedCents) }}；以上明细仅针对当前订阅链路。核查时间 {{ formatTime(data.asOf) }}。</p>
  </template>
 </section>
</template>

<style scoped>
.subscription-audit { min-width:0; margin:12px 0 18px; }
.subscription-audit__head,.subscription-audit__identity { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
.subscription-audit__identity { align-items:start; font-size:13px; }
.subscription-audit__identity nav { display:flex; gap:12px; flex:none; }
.subscription-audit small { display:block; color:var(--el-text-color-secondary); font-size:12px; line-height:1.6; overflow-wrap:anywhere; }
.subscription-audit a { color:var(--el-color-primary); text-decoration:none; overflow-wrap:anywhere; }
.subscription-audit__stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; padding:12px 0; }
.subscription-audit__stats > div { display:grid; gap:5px; }
.subscription-audit__stats span { color:var(--el-text-color-secondary); font-size:12px; }
.subscription-audit__stats b { font-size:18px; font-variant-numeric:tabular-nums; }
.subscription-audit__credits { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px 16px; margin:12px 0; }
.subscription-audit__credits dt { font-size:12px; color:var(--el-text-color-secondary); }
.subscription-audit__credits dd { margin:3px 0 0; font-size:13px; font-variant-numeric:tabular-nums; }
.subscription-audit__note { margin:8px 0; color:var(--el-text-color-secondary); font-size:12px; line-height:1.6; }
.subscription-audit__expanded { padding:10px 18px; white-space:pre-wrap; overflow-wrap:anywhere; }
.subscription-audit :deep(.el-pagination) { margin-top:12px; justify-content:flex-end; }
@media(max-width:700px){.subscription-audit__stats,.subscription-audit__credits{grid-template-columns:repeat(2,minmax(0,1fr))}.subscription-audit__identity{flex-wrap:wrap}}
</style>
