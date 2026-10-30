# 黄金矿工 Nginx 站点模板。占位符由 deploy.sh 替换:
#   __DOMAIN__ 域名   __ROOT__ 静态文件目录   __PORT__ 后端端口
# HTTPS 部分由 certbot --nginx 自动追加(443 + 证书 + 80 跳转 443)。
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;

    root __ROOT__;
    index index.html;

    server_tokens off;
    client_max_body_size 4k;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 5;
    gzip_types text/plain text/css text/javascript application/javascript application/json image/svg+xml;

    # 排行榜接口:反向代理到本机 Node 服务
    location /api/ {
        proxy_pass http://127.0.0.1:__PORT__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 15s;
    }

    # 游戏页面:每次都向服务器确认是否有新版本
    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
