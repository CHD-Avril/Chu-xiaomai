<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElAlert, ElButton, ElCard, ElForm, ElFormItem, ElInputNumber, ElMessage } from "element-plus";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/card/style/css";
import "element-plus/es/components/form/style/css";
import "element-plus/es/components/form-item/style/css";
import "element-plus/es/components/input-number/style/css";
import "element-plus/es/components/message/style/css";
import { fetchParticipationLimits, saveParticipationLimits, participationLimitsError, MAX_PARTICIPATION_LIMIT } from "../services/api";

const loading = ref(true), saving = ref(false), loadError = ref(""), saveError = ref("");
const saved = ref(null);
const form = reactive({ submissions: undefined, likes: undefined });
const changed = computed(() => saved.value && (form.submissions !== saved.value.submissions || form.likes !== saved.value.likes));
const validationMessage = computed(() => saved.value ? participationLimitsError(form) : "");

async function load() {
  if (saving.value) return;
  loading.value = true; loadError.value = ""; saveError.value = ""; saved.value = null;
  try {
    const limits = await fetchParticipationLimits();
    saved.value = limits; Object.assign(form, limits);
  } catch (error) { loadError.value = error?.message || "参与规则读取失败，请重试。"; }
  finally { loading.value = false; }
}

async function save() {
  if (loading.value || saving.value || !saved.value || !changed.value) return;
  saveError.value = validationMessage.value;
  if (saveError.value) return;
  saving.value = true;
  try {
    const limits = await saveParticipationLimits({ ...form }, saved.value);
    saved.value = limits; Object.assign(form, limits);
    ElMessage.success("参与规则已保存，后续操作按新上限校验。");
  } catch (error) { saveError.value = error?.message || "保存失败，请重试。"; }
  finally { saving.value = false; }
}

onMounted(load);
</script>

<template>
  <el-card class="panel-card participation-rules" shadow="never" :aria-busy="loading || saving">
    <template #header><div class="panel-heading"><span>每人每期参与上限</span><el-button :disabled="loading || saving" @click="load">重新读取</el-button></div></template>
    <p class="rules-intro">为所有 QQ 用户设置统一额度，适用于当前及以后的征集期；每一期独立计算。</p>
    <el-alert v-if="loadError" :title="loadError" type="error" :closable="false" show-icon />
    <p v-else-if="loading" class="muted" role="status">正在读取已保存的参与规则…</p>
    <el-form v-else-if="saved" label-position="top" class="rules-form" @submit.prevent="save">
      <div class="rules-fields">
        <el-form-item label="每人每期最多投稿几首歌">
          <el-input-number v-model="form.submissions" :min="1" :max="MAX_PARTICIPATION_LIMIT" :precision="0" :step="1" step-strictly controls-position="right" :disabled="saving" aria-label="每人每期投稿上限" />
          <p class="field-help">按 QQ 账号累计成功投稿的歌曲数，换设备不会重置额度。</p>
        </el-form-item>
        <el-form-item label="每人每期最多喜欢几首歌">
          <el-input-number v-model="form.likes" :min="1" :max="MAX_PARTICIPATION_LIMIT" :precision="0" :step="1" step-strictly controls-position="right" :disabled="saving" aria-label="每人每期喜欢上限" />
          <p class="field-help">按当前仍在喜欢的歌曲数计算，取消喜欢后会释放一个名额。</p>
        </el-form-item>
      </div>
      <el-alert title="降低上限不会删除已有投稿或票数。已超过新上限的账号将无法继续新增；仍可取消喜欢。" type="info" :closable="false" show-icon />
      <p class="field-help">两项上限都须至少为 1。暂停参与请在「征集期」中调整时间或归档；测试期仍需测试账号授权。</p>
      <el-alert v-if="saveError || validationMessage" :title="saveError || validationMessage" type="error" :closable="false" show-icon />
      <div class="rules-actions">
        <el-button type="primary" native-type="submit" :loading="saving" :disabled="!changed || !!validationMessage">保存参与规则</el-button>
        <span class="muted" role="status">{{ changed ? '有未保存的修改；重新读取会放弃这些修改。' : '当前显示已保存的规则。' }}</span>
      </div>
    </el-form>
  </el-card>
</template>

<style scoped>
.participation-rules { max-width: 900px; }
.rules-intro { margin: 0 0 24px; line-height: 1.8; }
.rules-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.rules-fields :deep(.el-input-number) { width: 100%; max-width: 280px; }
.field-help { flex-basis: 100%; margin: 10px 0; color: var(--el-text-color-secondary); font-size: .8125rem; line-height: 1.8; }
.rules-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; margin-top: 24px; }
@media (max-width: 767px) { .rules-fields { grid-template-columns: minmax(0, 1fr); gap: 0; } }
</style>
