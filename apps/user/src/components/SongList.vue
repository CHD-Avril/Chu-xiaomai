<script setup>
import { useSongsStore } from "../stores/songs";
import SongCard from "./SongCard.vue";
import Pagination from "./Pagination.vue";

const songsStore = useSongsStore();
</script>

<template>
  <section class="card list-panel">
    <div class="section-head list-head">
      <div>
        <p class="section-tag">Vote & Search</p>
        <h2>正在征集的歌单</h2>
      </div>
      <p class="section-note">搜索歌曲，给喜欢的投稿点亮支持。</p>
    </div>

    <div class="controls">
      <label class="field search-field">
        <span>搜索</span>
        <input
          type="search"
          maxlength="60"
          placeholder="搜索歌曲或歌手"
          :value="songsStore.searchTerm"
          @input="songsStore.setSearchTerm($event.target.value)"
        />
      </label>
      <label class="field sort-field">
        <span>排序</span>
        <select :value="songsStore.sortMode" @change="songsStore.setSortMode($event.target.value)">
          <option value="likes">按喜欢数排序</option>
          <option value="time">按投稿时间排序</option>
        </select>
      </label>
    </div>

    <div v-if="songsStore.errorMessage" class="notice">
      <strong>读取失败。</strong> {{ songsStore.errorMessage }}
    </div>

    <div class="songs-list" aria-live="polite">
      <template v-if="songsStore.paginatedSongs.length">
        <SongCard
          v-for="(song, index) in songsStore.paginatedSongs"
          :key="song.id"
          :song="song"
          :rank="(songsStore.currentPage - 1) * 12 + index + 1"
        />
      </template>
      <div v-else class="empty-state">
        <h3 class="empty-title">还没有投稿</h3>
        <p class="empty-copy">征集期开始后，同学们提交的歌曲会出现在这里。</p>
      </div>
    </div>

    <Pagination
      :current-page="songsStore.currentPage"
      :page-count="songsStore.pageCount"
      @change="songsStore.setPage"
    />
  </section>
</template>
