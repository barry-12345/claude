# 黄金矿工联机版 —— 由 deploy-online.sh 生成。不要添加 log 指令。
__DOMAIN__ {
	handle /online/* {
		reverse_proxy 127.0.0.1:__PORT__
	}
	handle {
		encode zstd gzip
		root * /var/www/goldminer
		header Cache-Control "no-cache"
		file_server
	}
}
