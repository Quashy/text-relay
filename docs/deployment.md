# 鑷儴缃蹭笌鍚庣画鍙戝竷

褰撳墠娌℃湁閮ㄧ讲鏈嶅姟鍣ㄣ€佸垱寤鸿繙绋嬫垨鐢熸垚閮ㄧ讲瀵嗛挜銆備互涓嬫槸鍙闃呮柟妗堬紱鐜版湁鏈嶅姟鍣ㄦ灦鏋勩€佸煙鍚嶃€丠TTPS 鍜屼唬鐞嗘嫇鎵戦渶鍦ㄧ敤鎴峰弬涓庣殑涓嬩竴姝ョ‘璁ゃ€?
## 涓€涓簲鐢紝涓€涓暟鎹嵎

鏈?Docker 鐨勬満鍣ㄥ彲浣跨敤 deploy/compose.yaml銆傝绀轰緥鍋囪 Nginx 鍦ㄥ涓绘満锛岄€氳繃 127.0.0.1:18080 璁块棶搴旂敤銆傚鍣ㄤ唬鐞嗘嫇鎵戦渶瑕佽皟鏁村彈闄愮綉缁滐紝涓嶈兘鐓ф妱銆?
1. 閰嶇疆 .env 涓殑瀹為檯 APP_ORIGIN=https://share.example.com锛涚敓浜у繀椤?HTTPS銆丆OOKIE_SECURE=true銆丯ODE_ENV=production銆?2. 鏋勫缓骞跺惎鍔ㄧ嫭绔?Compose project锛歚docker compose -f deploy/compose.yaml up -d --build`銆?3. 浜や簰鍒濆鍖栧敮涓€绠＄悊鍛橈細`docker compose -f deploy/compose.yaml exec app node dist/server/cli.js init`銆?4. 鏂板鏈珯 Nginx 閰嶇疆涓庤瘉涔︼紝鍙傝€冪ず渚嬶紱涓嶈鐩栫幇鏈夌珯鐐广€傚厛 nginx -t锛屽啀骞虫粦 reload銆?5. 楠岃瘉鍏ュ彛 HTTPS銆佺櫥褰曘€佽鍙栥€侀檺閫熷拰鐜版湁绔欑偣銆傛暟鎹笌澶囦唤涓虹嫭绔?named volume锛屽鍣ㄩ噸寤轰笉鍒犻櫎瀹冧滑锛涚姝?down -v銆?
绀轰緥瀹瑰櫒闈?root銆佸彧璇绘牴鐩綍銆佸崟鐙彲鍐欐暟鎹嵎锛屼笉鎸?Docker socket锛岄檺鍒?CPU/鍐呭瓨/杩涚▼銆傞暅鍍忔瀯寤轰笌杩愯鍧囦负 Node24 Debian锛屽師鐢?SQLite 鍖归厤鍚屼竴 Linux 鐜銆傛寮忔瀯寤哄墠纭 CPU 鏋舵瀯锛涙湰浜戠數鑴戞棤 Docker锛屽鍣ㄥ疄娴嬪皻鏈畬鎴愩€?
## 鐪熷疄鏉ユ簮 IP 涓庨檺閫?
搴旂敤榛樿涓嶄俊浠讳换浣曡浆鍙戝ご銆傚弽浠ｉ儴缃插悗璁剧疆 TRUSTED_PROXY 涓哄簲鐢ㄥ疄闄呯湅鍒扮殑**宸茬‘璁や唬鐞嗗湴鍧€/CIDR**銆傚涓?Nginx 杞彂鑷?Docker 鍙戝竷绔彛鏃跺彲鑳界湅鍒?bridge 缃戝叧鍦板潃锛屼笉鍙洸璁?loopback 鎴栦俊浠诲叏閮ㄧ綉娈点€傚厛鍦ㄩ殧绂婚厤缃牳瀹烇紝浠ｇ悊瑕嗙洊 X-Forwarded-For锛屽簲鐢ㄧ鍙ｄ粎鍥炵幆寮€鏀俱€侼ginx 绀轰緥鍙﹁ IP 鍜屽叏绔欏叆鍙ｉ绠楋紝缂栫爜璺緞浠嶅彈搴旂敤璺敱闄愰€熶繚鎶ゃ€傚鐢ㄦ埛鍏变韩鍑哄彛 IP 鐨勯槇鍊兼牴鎹疄闄呴噺璋冩暣銆?
搴旂敤鍋ュ悍妫€鏌ラ渶甯﹂厤缃煙鍚嶇殑 Host銆備唬鐞嗗繀椤讳繚鐣?Host銆侶TTP 鍙仛杞?HTTPS 鎴栬瘉涔︽牎楠岋紱HSTS 鍦ㄦ牳楠岃瘉涔︾画鏈熷拰鏈珯褰卞搷鍚庡惎鐢ㄣ€?
## 淇濇寔 CI/CD 绠€鍗?
褰撳墠 .github/workflows/ci.yml 鏄棤绉樺瘑鐨?CI锛氬畨瑁呴攣鏂囦欢 鈫?绫诲瀷妫€鏌?鈫?API 鈫?鏋勫缓 鈫?Chromium 鈫?渚濊禆瀹¤ 鈫?Docker 鏋勫缓銆侾R 鍜屽垎鏀潎涓嶆帴瑙︾敓浜у嚟鎹紝涔熶笉涓婁紶浜х墿銆侫ctions 鏄惁鍦?GitHub 瀹為檯杩愯锛岄渶涓嬩竴姝ユ帹閫佸悗楠岃瘉銆?
鍚庣画鎺ラ€?CD 鏃朵繚鐣欎竴涓伐浣滄祦锛宮ain push 涓旀鏌ュ叏閫氳繃鍚庯細
1. 鏋勫缓鐩爣鏈嶅姟鍣ㄦ灦鏋勯暅鍍忥紝鏍囩涓烘彁浜?SHA銆?2. 缁忓浐瀹氫富鏈烘寚绾瑰拰鍙楅檺閮ㄧ讲鍏ュ彛浼犺緭闀滃儚锛屼笉鎺堜簣鏅€?shell 鎴栧叏涓绘満 Docker 鎺у埗鏉冦€?3. 鍙栧緱椤圭洰鍙戝竷閿侊紝鎷掔粷杩囨椂鍙戝竷锛岃縼绉诲墠涓€鑷存€у浠姐€?4. 鍙洿鏂?TextRelay 瀹瑰櫒锛屽仴搴峰強 HTTPS 鍐掔儫閫氳繃鍐嶈褰曟垚鍔熴€?5. 澶辫触淇濈暀鏃ф湇鍔★紱浠呭湪 schema 鍏煎鏃跺洖婊氶暅鍍忥紝鏁版嵁搴撴仮澶嶅彟鎸夋紨缁冩楠ゅ鐞嗐€?
骞跺彂缁?cancel-in-progress:false锛屽姞鏈嶅姟鍣ㄥ彂甯冨簭鍙烽槻鏃ф瀯寤鸿鐩栨柊鐗堟湰銆備笉浣跨敤 pull_request_target銆傜瀵嗕粎缃簬鍙楁帶 GitHub environment/Secrets锛屼笉鍐欒繘 YAML 鎴栦粨搴撱€傚綋鍓嶆病鏈変负鏈煡鐩爣鍐欎竴涓亣瑁呭彲鐩存帴杩愯鐨勭敓浜ч儴缃叉楠ゃ€?
## GitHub 浜ゆ帴

鏈湴 Git 宸插噯澶囷紱涓嶈皟鐢?gh auth login銆佷笉鍒涘缓 origin銆佷笉 push銆傜敤鎴峰弬涓庢椂鍏堢‘璁よ处鍙?褰掑睘锛屽啀杩愯 GitHub CLI 鐨勮澶囩櫥褰曟祦绋嬶紝鐢?CLI 瀹為檯杩斿洖鍦板潃涓庡綋娆￠獙璇佺爜锛涗笉棰勫厛鐢熸垚浼氳繃鏈熺殑璁惧鐮併€傜劧鍚庢鏌ユ殏瀛樺唴瀹广€佸缓绔嬪叕鍏变粨搴撳苟鎸夌敤鎴锋壒鍑嗚寖鍥存帹閫併€?

# Production deployment

Operator setup (not performed by CI):
- Install reviewed deploy/deploy.sh as root:root 0755 /usr/local/sbin/textrelay-deploy, and deploy/ssh-command.sh as root:root 0755 /usr/local/sbin/textrelay-ssh-command. Never execute wrappers from the fetched repository.
- Create root-owned /opt/text-relay, /opt/text-relay/releases and a root-owned Git repository /opt/text-relay/repo. Keep all parent directories and repository configuration unwritable by ubuntu/the deployment key.
- Install reviewed deploy/production.yaml as /opt/text-relay/compose.yaml, root:root 0644. Preserve /opt/text-relay/.env (root:root 0600), with APP_ORIGIN=https://1.14.186.80 and existing app secrets. CI never copies or replaces these operator files. Compose resolves .env relative to this installed file.
- Preserve the existing text-relay project and its text-relay_textrelay-data and text-relay_textrelay-backups volumes. Confirm actual volume names before adoption; do not create an empty replacement for existing data. No down -v is used.
- Grant only the fixed wrapper via a reviewed sudoers entry: ubuntu ALL=(root) NOPASSWD: /usr/local/sbin/textrelay-deploy *
  The wrapper validates exactly one lowercase 40-character SHA. Validate sudoers using visudo. An already privileged ubuntu account is not a dedicated least-privilege account; the new SSH key is restricted separately.
- Add the dedicated public key to ubuntu authorized_keys with restrict,command="/usr/local/sbin/textrelay-ssh-command" options. No PTY, forwarding, arbitrary command, or shell is granted to this key. Keep the authorized_keys file and SSH setup under operator control.
- Configure repository secrets TEXTRELAY_DEPLOY_KEY and TEXTRELAY_SSH_KNOWN_HOSTS. Obtain and verify the server host key through a trusted independent channel; do not trust ssh-keyscan output alone. The known_hosts entry must match 1.14.186.80.
- Configure Nginx/TLS separately to proxy to 127.0.0.1:18080; host checks use 1.14.186.80.

Deploy TextRelay only responds to successful Check TextRelay push runs on main in Quashy/text-relay. No artifacts or code from the triggering run execute on the Actions runner. No checkout/setup actions are needed. GitHub concurrency and server flock serialize deployment; the wrapper rejects a SHA that is no longer origin/main, builds the exact archived commit, backs up SQLite via the running app CLI, then replaces the container. Initial deployment has no prior container to back up.

The old image is retained as text-relay:rollback. Failed health checks attempt image rollback and exit unsuccessfully. SQLite is not automatically restored: image rollback cannot undo schema changes or post-deployment writes. For incompatible migrations, stop and plan an operator-led recovery using the named-volume backup. Backups and release directories are retained; operator retention is required to prevent disk exhaustion. This is a brief-downtime single-container deployment, not zero-downtime.

The key authorizes deployment of current main; server-side checks enforce main identity, while successful-CI gating is enforced by the workflow. Protect main, workflow changes, secrets and operator access. A compromised deployment key could request current main without checking CI itself. Repository Dockerfile code is built with the Docker daemon; the trust boundary is approved main, not a sandbox for malicious repository maintainers.

Validation: bash syntax checks can run locally. Actual GitHub Actions execution is blocked by the account billing lock; do not bypass that lock or treat configuration as a verified automatic deployment. Neither server installation nor end-to-end rollout is implied by these files.