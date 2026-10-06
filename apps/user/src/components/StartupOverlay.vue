<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";

const emit = defineEmits(["done"]);

// 阶段序列
const PHASES = [
  { key: "black", zh: "长大小麦君", en: "CHU BROADCAST STATION", wait: 1600, interactive: false },
  { key: "perm", zh: "需要访问许可", en: "ACCESS PERMISSION REQUIRED", interactive: true },
  { key: "id", zh: "身份资料确认", en: "IDENTITY VERIFICATION", interactive: true },
  { key: "recv", zh: "接收访问需求", en: "ACCESS REQUEST RECEIVED", wait: 900, interactive: false },
  { key: "read", zh: "开始读取权限", en: "PERMISSION READ STARTED", wait: 1400, interactive: false, progress: true },
  { key: "ok", zh: "读取完毕 · 核验通过", en: "READ COMPLETE · VERIFIED", wait: 800, interactive: false },
];

const currentPhase = ref(0);
const typedText = ref("");
const progress = ref(0);
const skipping = ref(false);
const exiting = ref(false);
const glitch = ref(false);

let timers = [];
let typeTimer = null;

const wait = (ms) => new Promise((r) => {
  const t = setTimeout(r, ms);
  timers.push(t);
});

function typeEnglish(text) {
  typedText.value = "";
  if (typeTimer) clearInterval(typeTimer);
  let i = 0;
  typeTimer = setInterval(() => {
    typedText.value = text.slice(0, ++i);
    if (i >= text.length) clearInterval(typeTimer);
  }, 55);
}

async function runPhase(idx) {
  if (skipping.value) return finish();
  const phase = PHASES[idx];
  currentPhase.value = idx;
  typeEnglish(phase.en);

  if (phase.progress) {
    progress.value = 0;
    const step = 100 / (phase.wait / 50);
    const progTimer = setInterval(() => {
      progress.value = Math.min(100, progress.value + step);
    }, 50);
    timers.push(progTimer);
  }

  if (!phase.interactive) {
    await wait(phase.wait);
    if (idx < PHASES.length - 1) {
      runPhase(idx + 1);
    } else {
      finish();
    }
  }
}

function advance() {
  if (currentPhase.value < PHASES.length) {
    const phase = PHASES[currentPhase.value];
    if (phase.interactive) {
      if (currentPhase.value + 1 < PHASES.length) {
        runPhase(currentPhase.value + 1);
      } else {
        finish();
      }
    }
  }
}

async function finish() {
  if (exiting.value) return;
  exiting.value = true;
  glitch.value = true;
  await wait(450);
  emit("done");
}

function skip() {
  if (skipping.value) return;
  skipping.value = true;
  finish();
}

function onKey(e) {
  if (e.key === "Escape") return skip();
  const phase = PHASES[currentPhase.value];
  if (phase && phase.interactive && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    advance();
  }
}

onMounted(() => {
  typeEnglish(PHASES[0].en);
  window.addEventListener("keydown", onKey);
  runPhase(0);
});

onBeforeUnmount(() => {
  timers.forEach(clearTimeout);
  if (typeTimer) clearInterval(typeTimer);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div class="startup-overlay" :class="{ exiting, glitch }">
    <!-- 跳过按钮 -->
    <button class="skip-btn" type="button" @click="skip">跳过 [Esc]</button>

    <!-- 中央环形准星 -->
    <div class="reticle" aria-hidden="true">
      <div class="reticle-ring"></div>
      <div class="reticle-gap"></div>
    </div>

    <!-- 阶段内容 -->
    <div class="phase-content">
      <p class="phase-zh" :class="{ 'is-small': currentPhase === 0 }">
        {{ PHASES[currentPhase]?.zh }}
      </p>
      <p class="phase-en">{{ typedText }}</p>
      <div v-if="PHASES[currentPhase]?.progress" class="progress-bar">
        <div class="progress-fill" :style="{ width: progress + '%' }"></div>
      </div>
      <button
        v-if="PHASES[currentPhase]?.interactive"
        class="continue-btn"
        type="button"
        @click="advance"
      >
        继续 [Enter]
      </button>
    </div>

    <!-- 页脚 -->
    <p class="footer">POWERED BY CHU BROADCAST STATION</p>
  </div>
</template>

<style scoped>
.startup-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  background: #0a0a0a;
  color: #f5f0e8;
  font-family: "Manrope", "Noto Sans SC", sans-serif;
  transition: background 0.6s ease;
  overflow: hidden;
}

.startup-overlay.exiting {
  background: #f5f0e8;
  color: #1a1a1a;
}

/* 过曝：黑幕结束时闪一下白 */
.startup-overlay::before {
  content: "";
  position: absolute;
  inset: 0;
  background: #fff;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.4s ease;
}
.startup-overlay.exiting::before {
  opacity: 0.9;
  transition: opacity 0.2s ease;
}

/* 中央环形准星 */
.reticle {
  position: absolute;
  width: 260px;
  height: 260px;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.reticle-ring {
  position: absolute;
  inset: 0;
  border: 1.5px solid rgba(255, 117, 0, 0.55);
  border-radius: 50%;
  border-top-color: transparent;
  border-bottom-color: transparent;
  animation: spin 6s linear infinite;
}
.reticle-ring::before,
.reticle-ring::after {
  content: "";
  position: absolute;
  inset: -10px;
  border: 1px solid rgba(255, 117, 0, 0.2);
  border-radius: 50%;
}
.reticle-ring::after {
  inset: -24px;
  border-color: rgba(255, 117, 0, 0.12);
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 阶段内容 */
.phase-content {
  position: relative;
  z-index: 2;
  text-align: center;
  padding: 0 24px;
  max-width: 640px;
}
.phase-zh {
  margin: 0 0 14px;
  font-size: 1.9rem;
  font-weight: 900;
  letter-spacing: 0.12em;
  color: #f5f0e8;
  text-shadow: 0 0 24px rgba(255, 117, 0, 0.25);
}
.phase-zh.is-small {
  font-size: 2.4rem;
}
.startup-overlay.exiting .phase-zh {
  color: #1a1a1a;
  text-shadow: none;
}
.phase-en {
  margin: 0;
  font-family: "Courier New", ui-monospace, monospace;
  font-size: 0.85rem;
  letter-spacing: 0.32em;
  color: rgba(245, 240, 232, 0.7);
  min-height: 1.2em;
}
.startup-overlay.exiting .phase-en {
  color: rgba(26, 26, 26, 0.6);
}

.progress-bar {
  margin: 22px auto 0;
  width: 280px;
  height: 2px;
  background: rgba(255, 117, 0, 0.2);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: #ff7500;
  transition: width 0.05s linear;
}

.continue-btn {
  margin-top: 28px;
  padding: 10px 28px;
  background: transparent;
  color: #ff7500;
  border: 1px solid #ff7500;
  border-radius: 2px;
  font-size: 0.85rem;
  letter-spacing: 0.2em;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.continue-btn:hover {
  background: #ff7500;
  color: #0a0a0a;
}

.skip-btn {
  position: absolute;
  top: 20px;
  right: 24px;
  z-index: 3;
  background: transparent;
  border: none;
  color: rgba(245, 240, 232, 0.5);
  font-size: 0.75rem;
  letter-spacing: 0.15em;
  cursor: pointer;
}
.skip-btn:hover { color: #ff7500; }
.startup-overlay.exiting .skip-btn { color: rgba(26,26,26,0.5); }

.footer {
  position: absolute;
  bottom: 22px;
  right: 24px;
  margin: 0;
  font-size: 0.7rem;
  letter-spacing: 0.25em;
  color: rgba(245, 240, 232, 0.4);
}
.startup-overlay.exiting .footer { color: rgba(26,26,26,0.4); }

/* 揭幕色散故障 */
.startup-overlay.glitch .phase-zh {
  animation: glitch-skew 0.12s infinite alternate;
}
@keyframes glitch-skew {
  0% { transform: translate(0); opacity: 1; }
  20% { transform: translate(-2px, 1px); opacity: 0.8; }
  40% { transform: translate(2px, -1px); opacity: 1; }
  60% { transform: translate(-1px, 2px); opacity: 0.9; }
  80% { transform: translate(1px, -2px); opacity: 1; }
  100% { transform: translate(0); opacity: 1; }
}
</style>
