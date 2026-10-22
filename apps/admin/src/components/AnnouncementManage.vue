<script setup>
import { ElAlert, ElButton, ElCard, ElDialog, ElEmpty, ElForm, ElFormItem, ElInput, ElSwitch, ElTable, ElTableColumn, ElTag, ElMessage, ElMessageBox } from "element-plus";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/card/style/css";
import "element-plus/es/components/dialog/style/css";
import "element-plus/es/components/empty/style/css";
import "element-plus/es/components/form/style/css";
import "element-plus/es/components/form-item/style/css";
import "element-plus/es/components/input/style/css";
import "element-plus/es/components/switch/style/css";
import "element-plus/es/components/table/style/css";
import "element-plus/es/components/table-column/style/css";
import "element-plus/es/components/tag/style/css";
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/message-box/style/css";
import { computed, reactive, ref, watch } from "vue";
import { useAdminStore } from "../stores/admin";
import { useAuthStore } from "../stores/auth";
import * as api from "../services/api";
import { formatDateTime } from "../utils/format";
const store = useAdminStore(), auth = useAuthStore();
const form = reactive({ title: "", content: "", editingId: "" });
const key = "chu:announcement-draft:" + auth.adminUser.id;
const storageAvailable = ref(true);
try {
  const saved = JSON.parse(localStorage.getItem(key) || "null");
  if (saved && typeof saved.title === "string" && typeof saved.content === "string") Object.assign(form, { title: saved.title.slice(0,100), content: saved.content.slice(0,1000), editingId: typeof saved.editingId === "string" ? saved.editingId : "" });
} catch { storageAvailable.value = false; }
watch(form, () => {
  try {
    if (form.title || form.content || form.editingId) localStorage.setItem(key, JSON.stringify(form));
    else localStorage.removeItem(key);
    storageAvailable.value = true;
  } catch { storageAvailable.value = false; }
}, { flush: "sync" });
const publishing = ref(false), disablingId = ref(""), preview = ref(false), showClosed = ref(false);
const rows = computed(() => store.announcements.filter(a => showClosed.value || a.is_active));
async function replaceDraft(item) {
  if (form.title || form.content) {
    try { await ElMessageBox.confirm("替换当前草稿？尚未发布的修改将被清除。", "切换公告", { confirmButtonText: "替换草稿", cancelButtonText: "保留草稿", type: "warning" }); } catch { return; }
  }
  Object.assign(form, { title: item?.title || "", content: item?.content || "", editingId: item?.id || "" });
}
async function publish() {
  if (publishing.value) return;
  if (!form.title.trim() || !form.content.trim()) return ElMessage.warning("请填写公告标题和内容");
  publishing.value = true;
  let written = false;
  try {
    const payload = { title: form.title.trim(), content: form.content.trim(), createdBy: auth.adminUser.id };
    if (form.editingId) await api.updateAnnouncement(form.editingId, payload);
    else await api.insertAnnouncement(payload);
    written = true;
    Object.assign(form, { title: "", content: "", editingId: "" });
    preview.value = false;
    await store.refreshAnnouncements();
    ElMessage.success("公告已保存");
  } catch(e) { ElMessage.error(written ? "公告已保存，但列表刷新失败，请刷新数据。" : e.message || "保存失败，草稿已保留"); }
  finally { publishing.value = false; }
}
async function closeAnnouncement(item) {
  if (disablingId.value) return;
  try { await ElMessageBox.confirm("关闭「" + item.title + "」后，前台将不再展示这条公告，历史记录会保留。", "关闭公告", { type: "warning", confirmButtonText: "确认关闭", cancelButtonText: "取消" }); } catch { return; }
  disablingId.value = item.id;
  let written = false;
  try { await api.disableAnnouncement(item.id); written = true; await store.refreshAnnouncements(); ElMessage.success("公告已关闭"); }
  catch(e) { ElMessage.error(written ? "公告已关闭，但列表刷新失败，请刷新数据。" : e.message || "操作失败"); }
  finally { disablingId.value = ""; }
}
</script>
<template>
  <el-card class="panel-card" shadow="never">
    <template #header>{{ form.editingId ? '编辑公告' : '发布公告' }}</template>
    <el-alert v-if="!storageAvailable" title="浏览器存储不可用，草稿无法持久保存，请勿刷新或离开此页面。" type="warning" :closable="false" />
    <p v-else class="muted" role="status">草稿自动保存在当前浏览器，切换栏目或刷新后可继续编辑。草稿仅在此设备保存。</p>
    <el-form label-position="top" @submit.prevent="preview = true">
      <el-form-item label="标题" required><el-input v-model="form.title" maxlength="100" placeholder="如：本期征集开始啦" /></el-form-item>
      <el-form-item label="内容" required><el-input v-model="form.content" type="textarea" :rows="5" maxlength="1000" show-word-limit placeholder="写下要展示给同学们的通知" /></el-form-item>
      <div class="toolbar"><el-button type="primary" :disabled="publishing" @click="preview = true">预览与{{ form.editingId ? '保存' : '发布' }}</el-button><el-button :disabled="publishing" @click="replaceDraft(null)">清空 / 新建公告</el-button></div>
    </el-form>
    <el-alert type="info" :closable="false" show-icon title="活跃公告展示在首页告示栏，点击后查看全文；不会自动弹窗。编辑已关闭的公告不会重新发布。" />
  </el-card>
  <el-card class="panel-card" shadow="never">
    <template #header><div class="panel-heading"><span>公告记录</span><el-switch v-model="showClosed" active-text="包含已关闭" aria-label="包含已关闭" /></div></template>
    <el-table :data="rows" stripe>
      <el-table-column prop="title" label="标题" min-width="170" />
      <el-table-column prop="content" label="内容" min-width="240" show-overflow-tooltip />
      <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="row.is_active ? 'primary' : 'info'">{{ row.is_active ? '展示中' : '已关闭' }}</el-tag></template></el-table-column>
      <el-table-column label="更新时间" width="180"><template #default="{ row }">{{ formatDateTime(Date.parse(row.updated_at || row.created_at)) }}</template></el-table-column>
      <el-table-column label="操作" width="170"><template #default="{ row }"><el-button size="small" @click="replaceDraft(row)">编辑</el-button><el-button v-if="row.is_active" size="small" type="danger" plain :loading="disablingId === row.id" @click="closeAnnouncement(row)">关闭</el-button></template></el-table-column>
      <template #empty><el-empty description="暂无公告记录" :image-size="60" /></template>
    </el-table>
    <p class="muted">显示最近 100 条公告记录。</p>
  </el-card>
  <el-dialog v-model="preview" title="公告预览" width="min(600px, 94vw)" :close-on-click-modal="false" :show-close="!publishing" :close-on-press-escape="!publishing">
    <article class="announcement-preview"><span class="preview-kicker">CHU BROADCAST / 公告</span><h2>{{ form.title.trim() || '公告标题' }}</h2><p>{{ form.content.trim() || '请填写公告内容' }}</p></article>
    <p class="muted">保存后{{ form.editingId ? '更新原公告内容，保持其展示状态。' : '立即在前台展示。' }}</p>
    <template #footer><el-button :disabled="publishing" @click="preview = false">返回编辑</el-button><el-button type="primary" :loading="publishing" @click="publish">{{ form.editingId ? '确认保存' : '确认发布' }}</el-button></template>
  </el-dialog>
</template>
