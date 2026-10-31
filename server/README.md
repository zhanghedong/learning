# Review API

Go + SQLite 账号与学习进度服务。已实现账号（网页与 App 共用）、6 套词卡、古诗文、期中冲刺计划、首字母默背与期中知识点的版本化同步、幂等重试与一致性备份。生产地址 https://review.studynote.me，邮件/短信自助注册与找回暂关闭。

运行、账号初始化、API 与部署说明见 [部署与联调](docs/部署与联调.md)。

```sh
go test -race ./...
go vet ./...
go build -o bin/review-api ./cmd/review-api
```
