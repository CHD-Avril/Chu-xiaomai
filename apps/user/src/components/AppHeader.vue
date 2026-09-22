<script setup>
defineEmits(["open-admin-login"]);
</script>

<template>
  <header class="site-header">
    <a class="brand" href="#/" aria-label="长安大学广播台首页">
      <span class="brand-mark" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span>
      </span>
      <span>
        <strong>长安大学广播台</strong>
        <small>CHU Broadcast Station</small>
      </span>
    </a>
    <button
      class="nav-action"
      type="button"
      aria-label="管理员入口"
      title="管理员入口"
      @click="$emit('open-admin-login')"
    >
      <span aria-hidden="true">✈</span>
      管理员入口
    </button>
  </header>
</template>
