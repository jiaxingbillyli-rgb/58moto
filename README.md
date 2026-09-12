# 58moto 站点

静态部署在 GitHub Pages。

## 数据更新

数据由 [GitHub Actions](.github/workflows/crawl.yml) 自动维护：

- **每周一 UTC 02:00（北京时间 10:00）自动跑**一次爬虫
- 也可从 GitHub Actions 页面手动触发

工作流：
1. 跑 `node update_data.js` 抓取 58moto.com 全部车型/品牌
2. 跑 `python 58moto_static/export_static.py` 导出 `data.json`
3. 自动 commit + push `data.json`
4. GitHub Pages 自动重建（约 90 秒生效）

失败重试 3 次，model 数量低于 1000 自动放弃（防止部分抓取污染数据）。

### 首次配置

1. 生成一个 fine-grained PAT（仅 `jiaxingbillyli-rgb/58moto` 仓库 Contents 写权限）
2. 在仓库 Settings → Secrets and variables → Actions 添加：
   - Name: `WORKFLOW_PUSH_TOKEN`
   - Value: `<your PAT>`

## 本地开发

```bash
# 抓数据（生成 58moto.db）
node update_data.js

# 导出 data.json
python 58moto_static/export_static.py

# 本地预览
cd 58moto_gh && python -m http.server 8080
```