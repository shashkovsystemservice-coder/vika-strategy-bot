# Vika Strategy Bot

Облачный Telegram-бот для последовательного сбора стратегических ответов по проекту IBA Wellness.

## Текущая архитектура MVP

**Telegram → Vercel Functions → Gemini 3.5 Transcribe → GitHub**

- **GitHub** — код, версия опросника и текстовые ответы.
- **Vercel** — выполнение webhook Telegram. Локальный компьютер не нужен.
- **Gemini 3.5 Transcribe** — транскрибация голосовых сообщений.
- **Telegram** — интерфейс Вики: вопрос → голосовой/текстовый ответ → следующий вопрос.

Supabase в первом MVP не используется.

## Главное: вопросы не зашиты в код

Опросник хранится в `data/questions.json`. Каждый вопрос имеет постоянный ID (`Q001`, `Q002` и т. д.).

Поэтому новые вопросы можно добавлять по ходу проекта без изменения основной логики бота. После подключения репозитория к Vercel commit в `main` создаёт новый deployment, и бот начинает видеть новую версию опросника.

Если новый вопрос нужно логически вставить между существующими, ему можно дать новый постоянный ID и поле `order`, например `15.5`. Старые ID не перенумеровываются, поэтому уже сохранённые ответы не теряют связь с вопросами.

## Где лежат ответы

`data/answers.json`

Для каждого Telegram-пользователя сохраняются:

- ID вопроса;
- снимок формулировки вопроса на момент ответа;
- полный транскрипт или текстовый ответ;
- тип ответа (`voice`, `text`, `skip`);
- статус;
- дата;
- Telegram message ID.

Аудиофайл постоянно не хранится: Vercel временно скачивает voice из Telegram, передаёт его Gemini и удаляет временный файл после транскрибации.

> Важно: репозиторий сейчас публичный. Пока в `data/answers.json` нет реальных ответов это нормально. Перед реальным использованием следует либо сделать репозиторий private, либо сознательно принять, что ответы будут публичны.

## Команды бота

- `/start` — начать/продолжить опрос;
- `/progress` — показать прогресс;
- `/repeat` — повторить текущий вопрос;
- `/skip` — пропустить текущий вопрос;
- `/whoami` — показать Telegram user ID для ограничения доступа.

Можно отвечать обычным текстом или Telegram voice.

## Переменные окружения Vercel

Секреты никогда не коммитятся в GitHub. Шаблон находится в `.env.example`.

Нужны:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
GEMINI_API_KEY
GITHUB_WRITE_TOKEN
SETUP_SECRET
```

Рекомендуемые настройки:

```text
GEMINI_TRANSCRIBE_MODEL=gemini-3.5-transcribe
GITHUB_REPO=shashkovsystemservice-coder/vika-strategy-bot
GITHUB_BRANCH=main
GITHUB_ANSWERS_PATH=data/answers.json
MAX_VOICE_SECONDS=600
ALLOWED_TELEGRAM_USER_ID=<Telegram ID Вики>
```

## Webhook

После деплоя и заполнения переменных окружения webhook можно зарегистрировать через защищённый endpoint:

```text
/api/setup-webhook?secret=<SETUP_SECRET>
```

Endpoint сам определит production URL Vercel и зарегистрирует `/api/telegram` в Telegram Bot API.

## Этапы запуска

1. Подключить GitHub-репозиторий к Vercel.
2. Создать Telegram-бота в BotFather.
3. Добавить Telegram token в Vercel Environment Variables.
4. Создать Gemini API key и добавить его в Vercel.
5. Создать GitHub credential с правом записи только в этот репозиторий и добавить его в Vercel.
6. Добавить webhook secret и setup secret.
7. Один раз вызвать `/api/setup-webhook`.
8. В Telegram выполнить `/whoami`, затем записать ID Вики в `ALLOWED_TELEGRAM_USER_ID`.
9. Проверить полный цикл: вопрос → voice → Gemini → текст → GitHub → следующий вопрос.

## Принцип работы с ChatGPT

Поскольку вопросы и ответы находятся в GitHub, владелец проекта может в дальнейшем попросить ChatGPT:

- добавить новые вопросы;
- изменить формулировки;
- посмотреть ответы Вики;
- найти незаполненные блоки;
- собрать ответы в таблицу, Word или PDF;
- обновить стратегию на основе новых данных.
