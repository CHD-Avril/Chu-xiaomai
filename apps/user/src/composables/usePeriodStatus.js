import { computed } from "vue";
import { usePeriodStore } from "../stores/period";
import { useSongsStore } from "../stores/songs";
import { formatDateTime } from "../utils/format";

export function usePeriodStatus() {
  const periods = usePeriodStore();
  const songs = useSongsStore();
  const period = computed(() => periods.currentPeriod);
  const status = computed(() => {
    if (songs.isLoading) return { label: "正在读取", className: "is-pending", copy: "正在确认本期征集信息…" };
    if (songs.errorMessage) return { label: songs.connectionIssue?.label || "读取异常", className: "is-closed", copy: songs.errorMessage };
    if (songs.refreshError) return { label: "更新失败", className: "is-closed", copy: `${songs.refreshError} 当前显示上次读取的结果。` };
    const item = period.value;
    if (!item) return { label: "暂未开放", className: "is-missing", copy: "新一期点歌征集正在准备中，欢迎稍后再来。" };
    if (periods.now < item.startsAt) return { label: "即将开始", className: "is-pending", copy: `${formatDateTime(item.startsAt)} 开放投稿` };
    if (periods.now > item.endsAt || item.status !== "active") return { label: "本期已结束", className: "is-closed", copy: `${formatDateTime(item.endsAt)} 已截止，投稿和投票已关闭，歌单结果仍可查看。` };
    if (songs.isRefreshing) return { label: "正在更新", className: "is-pending", copy: "正在同步征集期和票数，请稍候…" };
    if (item.isTest) return { label: "测试期", className: "is-pending", copy: `仅限测试账号 · ${formatDateTime(item.endsAt)} 截止` };
    return { label: "正在征集", className: "is-open", copy: `${formatDateTime(item.endsAt)} 截止投稿` };
  });
  return { period, status };
}
