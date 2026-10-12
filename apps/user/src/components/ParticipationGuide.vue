<template>
  <section class="card participation-guide" aria-labelledby="participationTitle">
    <details>
      <summary id="participationTitle">投稿、投票和播出说明<span class="guide-toggle" aria-hidden="true">展开查看</span></summary>
      <p class="section-note">无需登录即可投稿和投票。具体选曲和播出安排请查看广播台公告。</p>
      <dl class="participation-rules">
        <div><dt>什么时候可以参与？</dt><dd>本期征集开放后可投稿、投票，截止后仅展示结果。开放与截止时间以页面标注为准。</dd></div>
        <div><dt>歌曲已经有人提交了怎么办？</dt><dd>先在榜单搜索歌名或歌手，已有投稿可直接点喜欢。请准确填写歌名、歌手和版本信息，避免重复投稿。</dd></div>
        <div><dt>如何投票？</dt><dd>同一首歌的喜欢与点踩互斥，再次点击可取消。点踩需填写 1–20 字理由，交由管理员审核；取消点踩不会撤回已经提交的举报。投稿和投票有次数及频率限制，请以操作提示为准。</dd></div>
        <div><dt>喜欢数高就一定会播出吗？</dt><dd>喜欢数表示同学的支持，榜单不是已播出记录。具体选曲、播出时间和活动安排，以广播台发布的公告为准。</dd></div>
        <div><dt>填错了可以修改或撤回吗？</dt><dd>目前本站不提供自助修改或撤回。发现填写错误，请向广播台工作人员反馈，避免再次重复投稿。</dd></div>
        <div><dt>换设备后还记得我的投票吗？</dt><dd>投票状态按当前浏览器保存。换设备或清除本站数据后，原来的投票标记可能无法显示；请勿反复清除数据重复投票。</dd></div>
      </dl>
      <div class="guide-actions">
        <router-link class="text-link" to="/playlist">搜索歌单与投票 ↗</router-link>
        <router-link class="text-link" :to="{ name: 'home', hash: '#station-notices' }">查看广播台公告 ↗</router-link>
      </div>
    </details>
  </section>
</template>
