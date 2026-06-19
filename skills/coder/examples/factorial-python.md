# Example: factorial in Python (happy path)

## Запрос пользователя (Telegram)

> Напиши функцию факториала на Python

## Поведение main

1. Скилл `coder` загружен, триггер сработал.
2. Язык — Python (явно).
3. `sessions_spawn({ agentId: "code-writer", prompt: "Write a Python function `factorial(n: int) -> int` that returns the product of all positive integers up to and including n. Handle n<0 by raising ValueError. No external deps." })`
4. Ждёт push.
5. Получает код от code-writer.
6. Рендерит в чате.

## Ответ в чате (как должен выглядеть)

```python
def factorial(n: int) -> int:
    if n < 0:
        raise ValueError("factorial is undefined for negative integers")
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result
```

Итеративно, чтобы не съедать стек на больших `n`. `n=0` возвращает 1 по конвенции.

## Что не должно произойти

- ❌ main не пишет код в чате сам, минуя spawn.
- ❌ main не отвечает «мелкая задача, сделал быстро» с inline-кодом.
- ❌ main не предлагает «а давай я без sub-agent, так быстрее».
