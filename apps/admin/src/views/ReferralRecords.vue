<script setup lang="ts">
import { onBeforeUnmount,ref,watch } from 'vue';
import { ElMessage,ElMessageBox } from 'element-plus';
import { Search,Refresh,ArrowLeft,ArrowRight,Document } from '@element-plus/icons-vue';
import AdminDialog from '@/components/AdminDialog.vue';
import { request } from '@/request';

type RecordItem={orderId?:string;inviteeId:string;inviterId:string;inviterEmail:string;inviteeEmail:string;createdAt:string;orderCount?:number;netPoints?:number;basePoints?:number;points?:number;status?:string;decisionReason?:string;mode?:string;rate?:number;ledgerConsistent?:boolean;reversalReason?:string;configSnapshot?:Record<string,unknown>;settlementMonth?:string;settlementDueAt?:string;settledAt?:string;settlementId?:string;settlementError?:string;voidedAt?:string};
type Action={id:string;action:string;reason:string;createdAt:string;adminEmail:string};
const props=defineProps<{mode:'relations'|'rewards'}>();
const items=ref<RecordItem[]>([]),loading=ref(false),error=ref(''),query=ref(''),status=ref(''),page=ref(1),more=ref(false),busy=ref('');
const summary=ref<Record<string,number>>({}),selected=ref<RecordItem|null>(null),actions=ref<Action[]>([]),detailLoading=ref(false),detailError=ref('');
const month=ref('');
let controller:AbortController|undefined,details:AbortController|undefined;
const statusLabels:Record<string,string>={pending_settlement:'待结算',voided:'已取消',granted:'已到账',skipped:'未计提',recovery_pending:'待追回',reversed:'已冲正'};
const reasons:Record<string,string>={disabled:'活动关闭',below_minimum:'未达最低实付金额',pending_recovery:'存在待追回奖励',already_rewarded:'该好友已获奖',rounded_to_zero:'不足1积分',daily_limit:'当日额度已用完',daily_limit_partial:'按剩余日额度发放'};
async function load(nextPage=page.value){
 controller?.abort();const current=new AbortController();controller=current;loading.value=true;error.value='';
 try{const result=await request<{items:RecordItem[];page:number;hasMore:boolean;summary?:Record<string,number>}>(`/api/v1/admin/referral-${props.mode}`,{query:{q:query.value,page:nextPage,...(props.mode==='rewards'?{status:status.value,month:month.value || ''}:{})},signal:current.signal,silent:true});
 if(current.signal.aborted)return;items.value=result.items;page.value=result.page;more.value=result.hasMore;summary.value=result.summary||{};
 }catch(e){if(!current.signal.aborted)error.value=e instanceof Error?e.message:'读取失败'}finally{if(!current.signal.aborted)loading.value=false}
}
async function inspect(row:RecordItem){
 selected.value=row;actions.value=[];detailError.value='';details?.abort();const current=new AbortController();details=current;detailLoading.value=true;
 try{const result=await request<{items:Action[]}>(`/api/v1/admin/referral-rewards/${row.orderId}/actions`,{signal:current.signal,silent:true});if(!current.signal.aborted)actions.value=result.items}
 catch(e){if(!current.signal.aborted)detailError.value=e instanceof Error?e.message:'记录读取失败'}finally{if(!current.signal.aborted)detailLoading.value=false}
}
async function reverse(row:RecordItem){
 if(busy.value)return;
 let reason='';
 const awaiting=row.status==='pending_settlement';
 const message=awaiting?`取消 ${row.inviterEmail} 的 ${row.points} 待结算积分，不扣减钱包，不恢复计提额度或获奖次数，也不会向支付渠道退款。`:`本次将从 ${row.inviterEmail} 的普通积分中追回 ${row.points} 积分。余额不足将登记待追回并暂停后续返利；此操作不会向支付渠道退款。`;
 try{const result=await ElMessageBox.prompt(message,awaiting?'取消待结算奖励':row.status==='recovery_pending'?'重试追回返利':'确认返利冲正',{confirmButtonText:awaiting?'确认取消奖励':'确认追回',cancelButtonText:'返回',inputPlaceholder:'填写核查依据（6-300字）',inputValidator:value=>{const text=String(value||'').trim();return text.length>=6&&text.length<=300||'请填写6-300字的核查依据'},type:'warning'});reason=result.value.trim()}
 catch{return}
 busy.value=row.orderId!;
 try{const result=await request<{status:string;message:string}>(`/api/v1/admin/referral-rewards/${row.orderId}/reversal`,{method:'POST',body:{reason,confirmed:true,expectedStatus:row.status}});ElMessage.info(result.message);await load()}
 catch{}finally{busy.value=''}
}
watch(()=>props.mode,()=>{items.value=[];page.value=1;status.value='';month.value='';query.value='';selected.value=null;void load(1)},{immediate:true});
onBeforeUnmount(()=>{controller?.abort();details?.abort()});
</script>

<template><section class="referral-records">
 <div v-if="mode==='rewards'" class="referral-totals"><span>全局待结算 <b>{{summary.pendingSettlementPoints ?? '—'}}</b></span><span>累计到账 <b>{{summary.grantedPoints ?? '—'}}</b></span><span>净到账 <b>{{summary.netPoints ?? '—'}}</b></span><span>已追回 <b>{{summary.reversedPoints ?? '—'}}</b></span><span>待追回 <b>{{summary.pendingRecoveryPoints ?? '—'}}</b></span></div>
 <div class="referral-record-filters"><el-input v-model="query" :prefix-icon="Search" placeholder="搜索账号邮箱、用户 ID 或订单号" clearable @keyup.enter="load(1)" @clear="load(1)"/>
 <el-select v-if="mode==='rewards'" v-model="status" aria-label="奖励状态" @change="load(1)"><el-option label="全部状态" value=""/><el-option v-for="(label,key) in statusLabels" :key="key" :label="label" :value="key"/></el-select>
 <el-date-picker v-if="mode==='rewards'" v-model="month" type="month" value-format="YYYY-MM" placeholder="归属月份" @change="load(1)"/>
 <el-button :icon="Search" :loading="loading" @click="load(1)">查询</el-button><el-tooltip content="刷新"><el-button :icon="Refresh" aria-label="刷新记录" :disabled="loading" @click="load()"/></el-tooltip></div>
 <el-alert v-if="error" :title="error" type="error" :closable="false"/>
 <el-table v-loading="loading" :data="items" :row-key="mode==='rewards'?'orderId':'inviteeId'" empty-text="暂无记录" class="referral-record-table">
 <el-table-column label="邀请人 / 好友" min-width="250"><template #default="{row}"><div>{{row.inviterEmail}}</div><small class="muted">{{row.inviteeEmail}}</small></template></el-table-column>
 <el-table-column label="时间" width="175"><template #default="{row}">{{new Date(row.createdAt).toLocaleString()}}</template></el-table-column>
 <template v-if="mode==='relations'"><el-table-column label="已确认充值" prop="orderCount" width="120"/><el-table-column label="净返利积分" prop="netPoints" width="120"/></template>
 <template v-else>
 <el-table-column label="归属月份" width="105"><template #default="{row}">{{row.settlementMonth?.slice(0,7)}}</template></el-table-column>
 <el-table-column label="基础积分 / 奖励" width="145"><template #default="{row}">{{row.basePoints}} / {{row.points}}</template></el-table-column>
 <el-table-column label="状态 / 原因" min-width="160"><template #default="{row}"><el-tag :type="row.status==='recovery_pending'?'warning':row.status==='granted'?'success':'info'">{{statusLabels[row.status]}}</el-tag><small v-if="row.decisionReason" class="record-reason">{{reasons[row.decisionReason]||row.decisionReason}}</small></template></el-table-column>
 <el-table-column label="账本" width="90"><template #default="{row}"><el-tag :type="row.ledgerConsistent?'success':'danger'">{{row.ledgerConsistent?'一致':'异常'}}</el-tag></template></el-table-column>
 <el-table-column label="操作" width="175" fixed="right"><template #default="{row}"><el-tooltip content="查看明细"><el-button link :icon="Document" aria-label="查看明细" @click="inspect(row as RecordItem)"/></el-tooltip><el-button v-if="['pending_settlement','granted','recovery_pending'].includes(row.status)" link type="danger" :disabled="!!busy || !row.ledgerConsistent" @click="reverse(row as RecordItem)">{{row.status==='pending_settlement'?'取消待结算':row.status==='recovery_pending'?'重试追回':'冲正'}}</el-button></template></el-table-column>
 </template></el-table>
 <footer><el-button :icon="ArrowLeft" aria-label="上一页" :disabled="loading||page===1" @click="load(page-1)"/><span>第 {{page}} 页</span><el-button :icon="ArrowRight" aria-label="下一页" :disabled="loading||!more" @click="load(page+1)"/></footer>
 <AdminDialog :model-value="!!selected" title="返利明细与处理记录" width="800px" hide-footer @update:model-value="value=>{if(!value){selected=null;details?.abort()}}">
 <template v-if="selected"><dl class="referral-detail"><dt>订单</dt><dd>{{selected.orderId}}</dd><dt>原始规则</dt><dd>{{selected.mode==='percent'?`${selected.rate}%`:`固定 ${selected.rate} 积分`}}</dd><dt>归属月份</dt><dd>{{selected.settlementMonth?.slice(0,7)}}</dd><dt>应结算时间</dt><dd>{{selected.settlementDueAt?new Date(selected.settlementDueAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'—'}}（北京时间）</dd><dt>实际到账</dt><dd>{{selected.settledAt?new Date(selected.settledAt).toLocaleString():'未到账'}}</dd><dt>结算批次</dt><dd>{{selected.settlementId||'—'}}</dd><dt>结算异常</dt><dd>{{selected.settlementError||'—'}}</dd><dt>处理依据</dt><dd>{{selected.reversalReason||'—'}}</dd></dl><pre class="referral-snapshot">{{JSON.stringify(selected.configSnapshot,null,2)}}</pre>
 <el-alert v-if="detailError" :title="detailError" type="error" :closable="false"/><el-table v-loading="detailLoading" :data="actions" empty-text="暂无处理记录"><el-table-column label="操作" min-width="100"><template #default="{row}">{{row.action==='reward_voided'?'取消待结算':row.action==='reversal_completed'?'已追回':'申请冲正'}}</template></el-table-column><el-table-column label="操作人" prop="adminEmail" min-width="140"/><el-table-column label="依据" prop="reason" min-width="220"/><el-table-column label="时间" min-width="150"><template #default="{row}">{{new Date(row.createdAt).toLocaleString()}}</template></el-table-column></el-table></template></AdminDialog>
</section></template>

<style scoped>
.referral-record-filters { flex-wrap:wrap; }
.referral-records{display:flex;flex-direction:column;gap:14px;min-height:0;flex:1;overflow:auto}.referral-record-filters{display:flex;gap:10px;align-items:center}.referral-record-filters>.el-input{max-width:420px}.referral-record-filters>.el-select{width:150px}.referral-totals{display:flex;gap:28px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--border);font-size:13px}.referral-totals b{margin-left:8px;font-variant-numeric:tabular-nums}.muted,.record-reason{color:var(--ink-3);font-size:12px}.record-reason{display:block;margin-top:5px}.referral-records footer{display:flex;justify-content:flex-end;align-items:center;gap:14px;padding:8px 0;font-size:13px}.referral-detail{display:grid;grid-template-columns:90px 1fr;gap:10px;font-size:13px}.referral-detail dd{margin:0;overflow-wrap:anywhere}.referral-snapshot{background:var(--surface-2);padding:14px;font-size:12px;max-height:180px;overflow:auto;border-radius:6px}
</style>
