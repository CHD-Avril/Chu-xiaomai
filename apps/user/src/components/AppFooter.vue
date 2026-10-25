<script setup>
import { getAdminUrl } from "../services/adminEntry";
import { usePeriodStore } from "../stores/period";
const periodStore = usePeriodStore();
const adminUrl = getAdminUrl();
</script>

<template>
  <footer class="site-footer">
    <div class="footer-inner">
      <span class="brand-mark small" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </span>
      <p><strong>用声音陪伴你的每一段时光</strong><br />长安大学广播台 · 长大小麦君</p>
      <b>在长大，听见更多美好</b>
      <a
        class="filing-link"
        href="https://beian.miit.gov.cn/"
        target="_blank"
        rel="noopener noreferrer"
      >
        黑ICP备2026012291号-1
      </a>
    </div>
    <div class="footer-actions">
      <span>{{ periodStore.currentPeriod?.isTest ? '测试期需 QQ 登录及测试账号授权' : '游客可浏览 · QQ 登录后投稿和投票' }}</span>
      <a class="text-link" aria-label="管理员入口" :href="adminUrl">管理入口 ↗</a>
    </div>
  </footer>
</template>

<style scoped>
.filing-link {
  padding: 4px 8px;
  font-size: 0.78rem;
  line-height: 1.6;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.filing-link:hover,
.filing-link:focus-visible {
  color: var(--blue);
}
</style>
