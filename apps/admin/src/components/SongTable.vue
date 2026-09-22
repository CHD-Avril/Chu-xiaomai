<script setup>
import { computed, ref } from "vue";
import { useAdminStore } from "../stores/admin";
import { formatDateTime } from "../utils/format";

const adminStore = useAdminStore();
const keyword = ref("");

const filteredSongs = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return adminStore.songs;
  return adminStore.songs.filter(
    (song) => song.titleLower.includes(kw) || song.artistLower.includes(kw),
  );
});
</script>

<template>
  <div>
    <el-card class="panel-card" shadow="never">
      <template #header>
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px">
          <span>本期歌曲（{{ adminStore.songs.length }} 首）</span>
          <el-input
            v-model="keyword"
            placeholder="搜索歌曲或歌手"
            clearable
            style="width: 260px"
          />
        </div>
      </template>

      <el-alert
        v-if="!adminStore.currentPeriod"
        type="info"
        :closable="false"
        show-icon
        title="当前没有进行中的征集期，请先到「征集期」新建一期。"
        style="margin-bottom: 12px"
      />

      <el-table :data="filteredSongs" stripe sortable>
        <el-table-column type="index" label="#" width="60" />
        <el-table-column prop="title" label="歌曲" min-width="200" show-overflow-tooltip />
        <el-table-column prop="artist" label="歌手" min-width="160" show-overflow-tooltip />
        <el-table-column label="喜欢" width="110" sortable :sort-method="(a, b) => a.likesCount - b.likesCount">
          <template #default="{ row }">
            <el-tag type="primary" effect="plain">{{ row.likesCount }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="点踩" width="110" sortable :sort-method="(a, b) => a.dislikesCount - b.dislikesCount">
          <template #default="{ row }">
            <el-tag :type="row.dislikesCount > 0 ? 'danger' : 'info'" effect="plain">{{ row.dislikesCount }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.isLocked" type="danger" size="small">已锁定</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="投稿时间" width="180">
          <template #default="{ row }">{{ formatDateTime(row.createdAtMs) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!filteredSongs.length" description="还没有歌曲投稿" :image-size="80" />
    </el-card>
  </div>
</template>
