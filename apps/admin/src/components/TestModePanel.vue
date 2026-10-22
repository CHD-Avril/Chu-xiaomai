<script setup>
import { computed, onMounted, ref } from "vue";
import { ElAlert, ElButton, ElCard, ElEmpty, ElForm, ElFormItem, ElInput, ElMessage, ElMessageBox, ElTable, ElTableColumn, ElTag } from "element-plus";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/card/style/css";
import "element-plus/es/components/empty/style/css";
import "element-plus/es/components/form/style/css";
import "element-plus/es/components/form-item/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/table/style/css";
import "element-plus/es/components/table-column/style/css";
import "element-plus/es/components/tag/style/css";
import { useAdminStore } from "../stores/admin";
import * as api from "../services/api";
const store = useAdminStore();
const accounts = ref([]), email = ref(""), loading = ref(false), busy = ref(false), error = ref("");
const activeCount = computed(() => accounts.value.filter(a => a.enabled).length);
async function readAccounts() {
  loading.value = true; error.value = "";
  try { accounts.value = await api.fetchTestAccounts(); }
  catch (cause) { error.value = cause?.message || "测试账号读取失败。"; }
  finally { loading.value = false; }
}
async function saveAccount(accountEmail, enabled) {
  if (busy.value) return;
  if (!enabled) {
    try { await ElMessageBox.confirm(`撤销「${accountEmail}」的测试权限？该账号将无法继续访问测试期。`, "撤销测试权限", { confirmButtonText: "撤销权限", cancelButtonText: "取消", type: "warning" }); }
    catch { return; }
  }
  busy.value = true;
  let written = false;
  try {
    await api.setTestAccount(accountEmail, enabled); written = true;
    if (enabled) email.value = "";
    await readAccounts();
    ElMessage.success(enabled ? "已授权测试账号" : "已撤销测试权限");
  } catch (cause) { ElMessage.error(written ? "权限已保存，请重新读取账号列表。" : cause?.message || "保存测试权限失败。"); }
  finally { busy.value = false; }
}
async function toggleMode() {
  const period = store.currentPeriod;
  if (!period || busy.value) return;
  const enabled = !period.isTest;
  try {
    await ElMessageBox.confirm(enabled
      ? `将「${period.title}」设为测试期？开启后仅授权测试账号可查看歌单、投稿和投票。本期现有歌曲和票数保留。`
      : `关闭「${period.title}」的测试模式？本期所有歌曲（包括测试投稿）将公开展示；在征集时间内，访客恢复免登录投稿和投票。`, enabled ? "开启测试模式" : "恢复正式征集", {
      confirmButtonText: enabled ? "开启测试模式" : "确认公开本期内容", cancelButtonText: "取消", type: "warning",
    });
  } catch { return; }
  busy.value = true;
  let written = false;
  try {
    await api.setPeriodTestMode(period.id, enabled, period.isTest); written = true;
    await store.refreshAll();
    ElMessage.success(enabled ? "当前征集期已设为测试期" : "已关闭测试模式");
  } catch (cause) { ElMessage.error(written ? "模式已保存，但工作台刷新失败，请重新读取。" : cause?.message || "测试模式切换失败。"); }
  finally { busy.value = false; }
}
onMounted(readAccounts);
</script>

<template>
  <el-card class="panel-card test-mode-panel" shadow="never">
    <template #header><div class="panel-heading"><span>测试模式</span><el-tag :type="store.currentPeriod?.isTest ? 'warning' : 'info'">{{ store.currentPeriod?.isTest ? '测试期 · 仅测试账号可用' : '未开启' }}</el-tag></div></template>
    <p>将当前征集期设为测试期后，仅运营人员授权的测试账号可以在用户端查看歌单、投稿和投票。关闭后恢复正常开放；归档后的测试期仍保留访问限制。</p>
    <div class="toolbar">
      <el-button :type="store.currentPeriod?.isTest ? 'primary' : 'warning'" :loading="busy" :disabled="!store.currentPeriod || store.loading || loading || !!error || (!store.currentPeriod.isTest && !activeCount)" @click="toggleMode">{{ store.currentPeriod?.isTest ? '关闭测试模式' : '开启测试模式' }}</el-button>
      <span class="muted">{{ store.currentPeriod ? `当前：${store.currentPeriod.title}` : '请先新建征集期' }}</span>
    </div>
    <el-alert v-if="store.currentPeriod?.isTest" title="关闭测试模式会公开本期全部内容。若只需保留测试记录，可直接归档本期，再新建正式征集期。" type="warning" :closable="false" show-icon />
    <h3>测试账号授权</h3>
    <p class="muted">先在 Supabase 控制台 → Authentication → Users 创建邮箱账号并设置密码，再在这里授权。用户端使用该邮箱和密码登录；QQ 登录不授予测试权限，测试账号也不会自动成为管理员。</p>
    <el-form class="toolbar" @submit.prevent="saveAccount(email, true)">
      <el-form-item label="账号邮箱"><el-input v-model="email" type="email" aria-label="授权测试账号邮箱" placeholder="已创建的账号邮箱" :disabled="busy || loading" required style="max-width: 320px" /></el-form-item>
      <el-button type="primary" native-type="submit" :loading="busy" :disabled="!email.trim() || loading || !!error">授权测试账号</el-button>
      <el-button :disabled="busy || loading" @click="readAccounts">刷新账号列表</el-button>
    </el-form>
    <el-alert v-if="error" :title="error" description="首次使用请执行项目中的 supabase-test-mode.sql，随后刷新账号列表。" type="error" :closable="false" show-icon />
    <p v-if="loading" role="status">正在读取测试账号…</p>
    <el-table v-else-if="!error && accounts.length" :data="accounts" stripe>
      <el-table-column prop="email" label="测试账号" min-width="200" />
      <el-table-column label="权限" width="100"><template #default="{ row }"><el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '已授权' : '已撤销' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="130"><template #default="{ row }"><el-button :type="row.enabled ? 'danger' : 'primary'" plain :disabled="busy" @click="saveAccount(row.email, !row.enabled)">{{ row.enabled ? '撤销权限' : '重新授权' }}</el-button></template></el-table-column>
    </el-table>
    <el-empty v-else-if="!error && !loading" description="暂无测试账号，请先授权至少一个账号再开启测试模式" :image-size="60" />
  </el-card>
</template>
