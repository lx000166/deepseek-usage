# Change Log

All notable changes to the "deepseek-usage" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.1] - 2026-05-07

### Added
- 自动检测充值：余额增加时自动重置当日起始余额
- 窗口焦点感知：失焦暂停轮询，聚焦智能恢复
- 递归 setTimeout 替代 setInterval，补齐剩余等待时间

### Changed
- 今日用量改为余额差值法计算（不再依赖不可用的用量 API）
- 去掉状态栏图标，使用纯文本显示

### Fixed
- 修复用量 API 404 错误（DeepSeek 未公开该端点）

## [1.0.0] - 2026-05-06

- 初始发布