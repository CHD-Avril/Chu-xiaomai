<script setup>
import { computed, ref } from "vue";
import { ElAlert, ElButton, ElCard, ElTag, ElTable, ElTableColumn, ElMessage, ElMessageBox } from "element-plus";
import "element-plus/es/components/alert/style/css";
import "element-plus/es/components/button/style/css";
import "element-plus/es/components/card/style/css";
import "element-plus/es/components/tag/style/css";
import "element-plus/es/components/table/style/css";
import "element-plus/es/components/table-column/style/css";
import "element-plus/es/components/message/style/css";
import "element-plus/es/components/message-box/style/css";
import { useAdminStore } from "../stores/admin";
import * as api from "../services/api";

const store = useAdminStore();

// 规则库：高风险直接建议锁定（reason 对应公告"歌单小规则"原文）
const HIGH_RISK = [
  { pattern: /台独|港独|疆独|藏独|分裂国家|反动|政治敏感|台湾国|反华/i, reason: "政治敏感/分裂国家，绝对不播" },
  { pattern: /涉政|政府|领导人|主席|总书记|共产党|民运|六四|天安门|法轮功/i, reason: "涉政内容，绝对不播" },
  { pattern: /民族仇恨|宗教极端|恐怖主义|歧视.*民族|破坏团结|分裂.*民族/i, reason: "破坏民族团结/宗教极端，不播" },
  { pattern: /伊斯兰|清真寺|诵经|阿訇|传教|基督徒|教堂|祷告/i, reason: "宗教内容，一般不播（特殊节目除外）" },
  { pattern: /劣迹|封杀|涉毒|吸毒|嫖娼|偷税|范冰冰|吴亦凡|郑爽|张哲瀚|赵薇|高云翔|吴秀波|陈建州/i, reason: "劣迹/被封杀艺人，不播" },
  { pattern: /fuck|shit|bitch|操你|妈的|傻逼|艹|尼玛|狗日|卖淫|赌博|毒品/i, reason: "违法/低俗内容，不播" },
  { pattern: /DJ[·.・]|DJ版|DJ串烧|DJ/i, reason: "DJ类不播（公告规则3）" },
  { pattern: /喊麦|土嗨|电音|remix|串烧|慢摇|club/i, reason: "喊麦/土嗨/电音不播（公告规则3）" },
  { pattern: /洛天依|初音|VOCALOID|虚拟歌姬|虚拟歌手|V家|AI歌|赛博歌姬/i, reason: "虚拟歌姬不播（公告规则3）" },
  { pattern: /鬼畜|洗脑神曲|整活|恶搞|鬼叫|抖肩|咋了爸爸|江南Style|小苹果|最炫民族风|伤不起|忐忑/i, reason: "整活/鬼畜歌曲不播（公告规则3）" },
  { pattern: /主播|直播|网红|带货|微商|拼多多/i, reason: "商业化/网红带货不播（公告规则3）" },
];

const MEDIUM_RISK = [
  { pattern: /MC|mc喊麦|另类|民谣|摇滚|说唱|嘻哈|[Rr][Aa][Pp]/i, reason: "MC/说唱/另类曲风，建议人工复核是否合适校园广播" },
  { pattern: /(民谣|民族|民歌).*(改编|翻唱|整活)/i, reason: "民族歌曲改编/整活，已和解的需人工判断是否可播" },
  { pattern: /\(.*\)|（.*）|【.*】/, reason: "歌名带括号注释，可能是二次创作或整活" },
  { pattern: /[^一-龥a-zA-Z0-9\s·.,!?"'’‘-]/, reason: "含特殊符号，可能是火星文或整活" },
  { pattern: /(20\d{2}|19\d{2})/, reason: "歌名含年份，可能是整活歌曲" },
  { pattern: /抑郁|自杀|想死|绝望|恨|仇恨|愤怒|骂|怼/i, reason: "可能带负面情绪，建议人工复核是否适合校园广播" },
];

function evaluate(song) {
  const text = `${song.title} ${song.artist}`;
  for (const r of HIGH_RISK) {
    if (r.pattern && r.pattern.test(text)) return { level: "high", reason: r.reason };
  }
  for (const r of MEDIUM_RISK) {
    if (r.pattern && r.pattern.test(text)) return { level: "medium", reason: r.reason };
  }
  return null;
}

const flagged = computed(() => {
  return store.songs
    .filter(s => !s.isLocked)
    .map(s => ({ ...s, verdict: evaluate(s) }))
    .filter(s => s.verdict)
    .sort((a, b) => (a.verdict.level === "high" ? -1 : 1) - (b.verdict.level === "high" ? -1 : 1));
});

const highList = computed(() => flagged.value.filter(s => s.verdict.level === "high"));
const mediumList = computed(() => flagged.value.filter(s => s.verdict.level === "medium"));

const locking = ref(null);

async function lockSong(song) {
  try {
    await ElMessageBox.confirm(
      `确定锁定《${song.title} / ${song.artist}》？\n规则：${song.verdict.reason}\n锁定后停止投票并排除出导出歌单。`,
      "确认自动审核锁定",
      { type: "warning", confirmButtonText: "锁定", cancelButtonText: "再看看" }
    );
  } catch { return; }
  locking.value = song.id;
  try {
    await api.updateSong({ ...song, isLocked: true }, `[自动审核] ${song.verdict.reason}`);
    ElMessage.success(`已锁定《${song.title}》`);
    await store.refreshSongs();
  } catch (e) {
    ElMessage.error(e.message || "锁定失败");
  } finally {
    locking.value = null;
  }
}

async function lockAllHigh() {
  if (!highList.value.length) return;
  try {
    await ElMessageBox.confirm(
      `将一键锁定全部 ${highList.value.length} 首高风险歌曲，确认？`,
      "批量锁定高风险",
      { type: "warning", confirmButtonText: "全部锁定", cancelButtonText: "取消" }
    );
  } catch { return; }
  let ok = 0, fail = 0;
  for (const song of highList.value) {
    try {
      await api.updateSong({ ...song, isLocked: true }, `[自动审核] ${song.verdict.reason}`);
      ok++;
    } catch { fail++; }
  }
  ElMessage.success(`批量锁定完成：成功 ${ok} 首${fail ? `，失败 ${fail} 首` : ""}`);
  await store.refreshSongs();
}
</script>

<template>
  <el-card class="panel-card" shadow="never">
    <template #header>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span>自动审核 · 扫描本期 {{ store.songs.length }} 首投稿</span>
        <el-button v-if="highList.length" type="danger" :disabled="!!locking" @click="lockAllHigh">
          一键锁定全部高风险（{{ highList.length }}）
        </el-button>
      </div>
    </template>

    <el-alert
      v-if="!flagged.length"
      title="本期没有不能播放原因的歌曲，全部干净！"
      type="success"
      :closable="false"
      show-icon
    />

    <template v-else>
      <div style="margin-bottom:16px;display:flex;gap:12px;flex-wrap:wrap">
        <el-tag type="danger" size="large">高风险 {{ highList.length }} 首</el-tag>
        <el-tag type="warning" size="large">中风险 {{ mediumList.length }} 首</el-tag>
        <el-tag type="success" size="large">正常 {{ store.songs.length - flagged.length }} 首</el-tag>
      </div>

      <h3 style="margin:16px 0 8px;color:#f56c6c">高风险 · 建议直接锁定</h3>
      <el-table v-if="highList.length" :data="highList" stripe size="small">
        <el-table-column prop="title" label="歌曲" min-width="180" />
        <el-table-column prop="artist" label="歌手" min-width="150" />
        <el-table-column prop="likesCount" label="喜欢" width="80" />
        <el-table-column label="不能播放原因" width="180">
          <template #default="{ row }"><el-tag type="danger" size="small">{{ row.verdict.reason }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-button size="small" type="danger" :loading="locking === row.id" @click="lockSong(row)">锁定</el-button>
          </template>
        </el-table-column>
      </el-table>

      <h3 style="margin:20px 0 8px;color:#e6a23c">中风险 · 建议人工复核</h3>
      <el-table v-if="mediumList.length" :data="mediumList" stripe size="small">
        <el-table-column prop="title" label="歌曲" min-width="180" />
        <el-table-column prop="artist" label="歌手" min-width="150" />
        <el-table-column prop="likesCount" label="喜欢" width="80" />
        <el-table-column label="不能播放原因" width="180">
          <template #default="{ row }"><el-tag type="warning" size="small">{{ row.verdict.reason }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-button size="small" type="danger" plain :loading="locking === row.id" @click="lockSong(row)">锁定</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <div class="muted" style="margin-top:20px;font-size:12px;line-height:1.7">
      <p><strong>规则说明：</strong>高风险含政治敏感、民族宗教、劣迹艺人、违法低俗、DJ/喊麦/虚拟歌姬/鬼畜整活、网红带货等；中风险含MC/说唱/已和解民族改编/特殊符号/负面情绪等，人工复核。规则基于公告"歌单小规则"第 1-4 条。</p>
      <p>锁定操作会自动写入操作记录，原因标注"[自动审核]"，可在歌曲管理里查看。</p>
    </div>
  </el-card>
</template>
