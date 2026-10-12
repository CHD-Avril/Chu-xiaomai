import { createApp } from "vue";
import { createPinia } from "pinia";
import { ElLoading } from "element-plus";
import "element-plus/es/components/loading/style/css";
import "element-plus/theme-chalk/base.css";
import "../../shared/theme.css";
import App from "./App.vue";
import router from "./router";
import "./styles/main.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(ElLoading);
app.mount("#app");
