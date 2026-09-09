<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Download, Refresh } from '@element-plus/icons-vue';
import { request, isRequestAborted } from '@/request';
import { billingMoney, type AccountingSummary, type BillingOrder } from '@/billingTypes';
import { downloadAdminCsv } from '@/downloadCsv';
import { formatPoints, formatTime } from '@/utils';

interface Benefit {
 billingVersion:number;
 id:string;orderId:string | null;planName:string;status:string;startsAt:string;endsAt:string;dailyPoints:number;
 availablePoints:number;taskFrozenPoints:number;heldPoints:number;spentPoints:number;expiredPoints:number;nextResetAt:string | null;changing:boolean;
 policy:{channels:string[];featureKeys:string[];modelIds:string[]};
 contract?:{id:string;concurrencyBonus:number;priceBookId:string;lockModelPrices:boolean;allowTopupPriceLock:boolean} | null;
}
interface BillingData {
 items:Benefit[];total:number;wallet:Record<string,number>;unclassifiedNormalPoints:number;
 pendingOrders:BillingOrder[];pendingChanges:{id:string;kind:string;status:string;amountCents:number}[];
 refundEligibility:{eligible:boolean;reason:string;calculation?:{maxRefundCents:number;spentPoints:number;protectedUsagePoints:number;taskFrozenPoints:number;protectedTopupFrozenPoints:number}};
 protection:{available:boolean;allowTopup?:boolean;reason:string};concurrency:{base:number;bonus:number;limit:number;running:number;imageRunning?:number;imageLimit?:number;chatRunning?:number;chatLimit?:number};finance:AccountingSummary;
}
interface Lot {
 id:string;bucket:string;name:string;orderId:string | null;subscriptionId:string | null;
 grantedPoints:number;availablePoints:number;frozenPoints:number;heldPoints:number;spentPoints:number;expiredPoints:number;revokedPoints:number;
 holdReason:string;priceLockEligible:boolean;createdAt:string;expiresAt:string | null;
 rechargePolicy?:{pointsPerYuan:number;priceLockMinYuan:number} | null;
 policy?:{channels:string[];featureKeys:string[];modelIds:string[]} | null;
}
const props=defineProps<{userId:string}>();const router=useRouter();
const data=ref<BillingData | null>(null), lots=ref<Lot[]>([]), lotTotal=ref(0);
const loading=ref(false),error=ref(''),exporting=ref(false),view=ref('benefits');
const page=ref(1),lotPage=ref(1),bucket=ref(''),state=ref('');
let controller:AbortController | undefined;
async function load(){
 controller?.abort();const own=new AbortController();controller=own;const id=props.userId;
 loading.value=true;error.value='';
 try{
  const [billing,batches]=await Promise.all([
   request<BillingData>(`/api/v1/admin/users/${id}/billing`,{query:{page:page.value,limit:10},signal:own.signal,silent:true}),
   request<{items:Lot[];total:number}>(`/api/v1/admin/users/${id}/credit-lots`,{query:{page:lotPage.value,limit:20,bucket:bucket.value,state:state.value},signal:own.signal,silent:true}),
  ]);
  if(!own.signal.aborted&&props.userId===id){data.value=billing;lots.value=batches.items;lotTotal.value=batches.total}
 }catch(e){if(controller===own&&!own.signal.aborted&&!isRequestAborted(e))error.value=e instanceof Error?e.message:'权益读取失败'}
 finally{if(controller===own)loading.value=false}
}
watch(()=>props.userId,()=>{page.value=1;lotPage.value=1;data.value=null;lots.value=[];lotTotal.value=0;load()},{immediate:true});
onBeforeUnmount(()=>controller?.abort());
function filterLots(){lotPage.value=1;load()}
function order(id:string | null){if(id)router.push({path:'/orders',query:{search:id,orderId:id}})}
function changes(id:string){router.push({path:'/subscription-changes',query:{search:id}})}
const statusLabel=(s:string)=>({active:'生效中',refunding:'退订处理中',cancelled:'已退订',expired:'已到期',pending:'待支付',uncertain:'待核实',paid:'到账确认中',reviewing:'审核中',processing:'退款处理中'}[s]||s);
async function exportLots(){
 exporting.value=true;
 try{await downloadAdminCsv(`/api/v1/admin/users/${props.userId}/credit-lots/export`,{bucket:bucket.value,state:state.value},'积分批次.csv')}
 catch(e){ElMessage.error(e instanceof Error?e.message:'导出失败')}
 finally{exporting.value=false}
}
</script>

<template>
 <div v-loading="loading" class="user-billing">
  <header><strong>权益与积分批次</strong><el-button :icon="Refresh" size="small" :loading="loading" @click="load">刷新</el-button></header>
  <el-alert v-if="error" :title="data ? `${error}（以下为上次成功读取结果）` : error" type="error" :closable="false" />
  <template v-if="data">
   <section v-if="data.pendingOrders.length || data.pendingChanges.length" class="user-billing__pending">
    <strong>待处理事项</strong>
    <div v-for="item in data.pendingOrders" :key="item.id"><span>{{ item.planName }} · {{ statusLabel(item.status) }} · {{ billingMoney(item.amountCents) }}</span><el-button link type="primary" @click="order(item.id)">查看订单</el-button></div>
    <div v-for="item in data.pendingChanges" :key="item.id"><span>{{ item.kind==='refund'?'退订退款':'订阅升级' }} · {{ statusLabel(item.status) }} · {{ billingMoney(item.amountCents) }}</span><el-button link type="primary" @click="changes(item.id)">查看处理记录</el-button></div>
   </section>
   <div class="user-billing__metrics">
    <div><small>确认实收</small><strong>{{ billingMoney(data.finance.receivedCents) }}</strong></div>
    <div><small>确认退款</small><strong>{{ billingMoney(data.finance.refundedCents) }}</strong></div>
    <div><small>净收款</small><strong>{{ billingMoney(data.finance.netCents) }}</strong></div>
    <div><small>图片并发占用</small><strong>{{ data.concurrency.imageRunning ?? data.concurrency.running }} / {{ data.concurrency.imageLimit ?? data.concurrency.limit }} 张</strong></div>
   </div>
   <dl class="user-billing__facts">
    <template v-if="data.concurrency.chatLimit != null"><dt>对话并发占用</dt><dd>{{ data.concurrency.chatRunning ?? 0 }} / {{ data.concurrency.chatLimit }} 次；与图片额度独立</dd></template>
    <dt>订阅退款资格</dt><dd>{{ data.refundEligibility.reason }}<span v-if="data.refundEligibility.eligible"> · 可申请上限 {{ billingMoney(data.refundEligibility.calculation?.maxRefundCents) }}</span></dd>
    <dt>价格保护</dt><dd>{{ data.protection.reason }}</dd>
    <dt>合格充值余额</dt><dd>{{ formatPoints(data.wallet.eligibleTopupPoints || 0) }} 积分；{{ data.protection.allowTopup?'订阅支持充值锁价':'当前未生效充值锁价权益' }}</dd>
    <dt>其他通用余额</dt><dd>{{ formatPoints(data.unclassifiedNormalPoints) }} 积分（未归入充值批次的历史或活动余额，不重复加到钱包总额）</dd>
   </dl>
   <el-alert v-if="data.finance.unallocatedRefundCents" type="warning" :closable="false" :title="`其中 ${billingMoney(data.finance.unallocatedRefundCents)} 退款未记录逐单归属，账户汇总已去重。`" />
   <el-tabs v-model="view">
    <el-tab-pane label="订阅权益" name="benefits">
     <el-table :data="data.items" size="small" max-height="390">
      <el-table-column type="expand"><template #default="{row}"><dl class="user-billing__facts is-expanded">
       <dt>使用渠道</dt><dd>{{ row.policy?.channels?.join('、') || '历史未记录' }}</dd>
       <dt>场景范围</dt><dd>{{ row.policy?.featureKeys?.length ? row.policy.featureKeys.join('、') : '全部场景' }}</dd>
       <dt>模型范围</dt><dd>{{ row.policy?.modelIds?.length ? row.policy.modelIds.join('、') : '全部模型' }}</dd>
       <dt>权益编号</dt><dd>{{ row.contract?.id || '历史未记录' }}</dd>
       <dt>价格保护</dt><dd>{{ !row.contract ? '历史未记录价格版本' : row.contract.lockModelPrices ? row.contract.allowTopupPriceLock ? '订阅及合格额度包' : '仅订阅积分' : '实时价格' }}</dd>
       <dt>价格版本</dt><dd>{{ row.contract?.priceBookId || '-' }}</dd>
       <dt>额外图片并发</dt><dd>+{{ row.contract?.concurrencyBonus || 0 }} 张</dd>
       <dt>任务冻结 / 变更冻结</dt><dd>{{ row.taskFrozenPoints }} / {{ row.heldPoints }}</dd>
       <dt>累计消费 / 到期失效</dt><dd>{{ row.billingVersion===1?'历史未分账':`${row.spentPoints} / ${row.expiredPoints}` }}</dd>
      </dl></template></el-table-column>
      <el-table-column label="订阅" min-width="150"><template #default="{row}">{{ row.planName || '历史订阅' }}<small class="user-billing__sub">每24小时 {{ formatPoints(row.dailyPoints) }} 积分</small></template></el-table-column>
      <el-table-column label="状态" width="120"><template #default="{row}">{{ row.changing?'变更处理中':statusLabel(row.status) }}</template></el-table-column>
      <el-table-column label="生效 / 到期" min-width="180"><template #default="{row}">{{ formatTime(row.startsAt) }}<small class="user-billing__sub">{{ formatTime(row.endsAt) }}</small></template></el-table-column>
      <el-table-column label="本期可用" width="95"><template #default="{row}">{{ row.billingVersion===1?'历史未分账':formatPoints(row.availablePoints) }}</template></el-table-column>
      <el-table-column label="下次重置" min-width="170"><template #default="{row}">{{ formatTime(row.nextResetAt) }}</template></el-table-column>
      <el-table-column label="记录" width="110"><template #default="{row}"><el-button link type="primary" @click="order(row.orderId)">订单</el-button><el-button link type="primary" @click="changes(row.id)">变更</el-button></template></el-table-column>
     </el-table>
     <el-pagination v-model:current-page="page" :page-size="10" :total="data.total" layout="total, prev, pager, next" @current-change="load" />
    </el-tab-pane>
    <el-tab-pane label="积分批次" name="lots">
     <div class="user-billing__filters">
      <el-select v-model="bucket" clearable placeholder="全部来源" aria-label="批次来源" @change="filterLots"><el-option label="充值积分" value="topup" /><el-option label="订阅积分" value="subscription" /></el-select>
      <el-select v-model="state" clearable placeholder="全部状态" aria-label="批次状态" @change="filterLots"><el-option v-for="option in [{value:'available',label:'有可用积分'},{value:'frozen',label:'任务冻结中'},{value:'held',label:'变更冻结中'},{value:'spent',label:'有消费'},{value:'expired',label:'有到期失效'},{value:'revoked',label:'有权益回收'}]" :key="option.value" :value="option.value" :label="option.label" /></el-select>
      <el-button :icon="Download" size="small" :loading="exporting" :disabled="loading || Boolean(error)" @click="exportLots">导出筛选批次</el-button>
     </div>
     <el-table :data="lots" size="small" max-height="390">
      <el-table-column type="expand"><template #default="{row}"><dl class="user-billing__facts is-expanded">
       <dt>批次编号</dt><dd>{{ row.id }}</dd><dt>来源订单</dt><dd><el-button link type="primary" @click="order(row.orderId)">{{ row.orderId || '未记录' }}</el-button></dd>
       <dt>发放总额</dt><dd>{{ row.grantedPoints }} 积分</dd><dt>购买时比例</dt><dd>{{ row.rechargePolicy ? `每元 ${row.rechargePolicy.pointsPerYuan} 积分` : '固定包或周期发放' }}</dd>
       <dt>购买时锁价门槛</dt><dd>{{ row.rechargePolicy ? `${row.rechargePolicy.priceLockMinYuan} 元` : '按原套餐资格' }}</dd>
       <dt>变更冻结原因</dt><dd>{{ row.holdReason==='refund'?'退订审核':row.holdReason==='upgrade'?'升级待支付':'无' }}</dd>
       <dt>到期时间</dt><dd>{{ row.expiresAt?formatTime(row.expiresAt):'不随订阅周期到期' }}</dd>
       <dt v-if="row.policy">适用范围</dt><dd v-if="row.policy">{{ row.policy.channels?.join('、') }}；场景 {{ row.policy.featureKeys?.join('、') || '全部' }}；模型 {{ row.policy.modelIds?.join('、') || '全部' }}</dd>
      </dl></template></el-table-column>
      <el-table-column label="来源" min-width="155"><template #default="{row}">{{ row.name }}<small class="user-billing__sub">{{ row.bucket==='topup'?'充值积分':'订阅积分' }} · {{ formatTime(row.createdAt) }}</small></template></el-table-column>
      <el-table-column prop="availablePoints" label="可用" width="78" />
      <el-table-column prop="frozenPoints" label="任务冻结" width="90" />
      <el-table-column prop="heldPoints" label="变更冻结" width="90" />
      <el-table-column prop="spentPoints" label="已消费" width="82" />
      <el-table-column prop="expiredPoints" label="已过期" width="82" />
      <el-table-column prop="revokedPoints" label="权益回收" width="90" />
      <el-table-column label="充值锁价资格" min-width="125"><template #default="{row}">{{ row.bucket==='topup' ? row.priceLockEligible?'符合':'不符合' : '按订阅权益' }}</template></el-table-column>
     </el-table>
     <el-pagination v-model:current-page="lotPage" :page-size="20" :total="lotTotal" layout="total, prev, pager, next" @current-change="load" />
    </el-tab-pane>
   </el-tabs>
  </template>
 </div>
</template>

<style scoped>
.user-billing{display:grid;gap:14px;min-height:200px;padding:16px;}
.user-billing header,.user-billing__pending>div{display:flex;justify-content:space-between;align-items:center;gap:12px;}
.user-billing__pending{display:grid;gap:8px;border-bottom:1px solid var(--border);padding-bottom:12px;font-size:13px;}
.user-billing__metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;padding:12px 0;border-block:1px solid var(--border);}
.user-billing__metrics>div{display:grid;gap:6px;min-width:0;}
.user-billing__metrics small,.user-billing__sub{font-size:11px;color:var(--ink-3);}
.user-billing__metrics strong{font-size:18px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
.user-billing__facts{display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px 12px;font-size:12px;margin:0;}
.user-billing__facts dt{color:var(--ink-3);}.user-billing__facts dd{margin:0;overflow-wrap:anywhere;}
.user-billing__facts.is-expanded{padding:16px;}.user-billing__sub{display:block;margin-top:3px;}
.user-billing__filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}.user-billing__filters .el-select{width:150px;}
.user-billing .el-pagination{justify-content:flex-end;margin-top:12px;}
@media(max-width:600px){.user-billing__metrics{grid-template-columns:repeat(2,minmax(0,1fr));}}
</style>
