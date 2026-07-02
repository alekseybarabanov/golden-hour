---

name: "student-portal"

description: "Личный учебный кабинет ученика в браузере или Telegram Mini App: дневной план + чат с Золотым часом. Триггеры: /web, «личный кабинет», «веб план», «открой в браузере»."

---



# student-portal — личный учебный кабинет



Учебный веб-интерфейс для **одного** пользователя: план на сегодня, Kanban/календарь и чат с ботом. Доступ по LAN-адресу хоста агента (`http://<host>:18791/my/…`): телефон должен быть в той же сети. Хост определяется автоматически (поле `mode` в JSON): `lan` — общий Wi‑Fi/роутер (в т.ч. Raspberry Pi), `hotspot` — мобильный хотспот Windows (`192.168.137.1`), `public` — HTTPS-туннель. Переопределить хост: `GH_STUDENT_PORTAL_HOST`.



## Когда



- `setup_status: complete`

- Триггеры: `/web`, «личный кабинет», «веб-план», «ссылка на план в браузере»

- **Mini App в браузере телефона:** подключить телефон к хотспоту ПК → открыть `portal_url` или `…/miniapp`



## Действие агента



```bash

node scripts/student-portal.mjs --user <user_key>

```



1. Взять **только** `portal_url` из JSON.

2. Отправить пользователю коротко:



> 🌅 **Личный кабинет:**  

> <portal_url>  

> Включи хотспот на ПК, подключи телефон к его Wi‑Fi и открой ссылку в браузере.



3. **Не** показывать: `user_key`, telegram id, token, пути к файлам.



## Запуск (владелец)



```powershell

cd dashboard

.\start_all_portals.ps1

# или

.\repair-portals.ps1

```



Порт **18791**, слушает `0.0.0.0`. Доступ с телефона по LAN-адресу хоста (общий Wi‑Fi/роутер, Raspberry Pi) или через мобильный хотспот Windows (`192.168.137.1`).



Опционально HTTPS для кнопки Telegram: `.\repair-portals.ps1 -WithTunnels` (локальный cloudflared на ПК, не VPS).



## Безопасность



- Ссылка = секрет; не пересылать чужим.

- `portal_url` — персональная ссылка с секретным token.

- Gateway остаётся на loopback; чат идёт через прокси портала.



## Файлы



| Путь | Назначение |

|---|---|

| `users/<user_key>/portal.json` | персональный токен |

| `dashboard/dashboard.html` | UI (тот же Felpik, режим student) |

| `dashboard/student_portal_backend.py` | API |

