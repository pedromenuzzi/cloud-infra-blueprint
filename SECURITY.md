# Política de Segurança

## Versões suportadas

Como o projeto está em desenvolvimento ativo (pré-1.0), só damos suporte à versão `main` mais recente. Após a v1.0, suportaremos a última `MAJOR` por 6 meses.

| Versão | Suportada         |
| ------ | ----------------- |
| `main` | Sim               |
| < 1.0  | Não (pré-release) |

## Reportando uma vulnerabilidade

**Não abra issues públicas para vulnerabilidades de segurança.**

Reporte de forma privada por um destes canais:

1. **GitHub Security Advisories** (preferido): use a aba **Security → Advisories → Report a vulnerability** no repositório.
2. **E-mail:** `security@cloudblueprint.dev` — se possível, criptografe com a chave PGP publicada em https://cloudblueprint.dev/.well-known/security.txt.

Inclua no seu relatório:

- Descrição da vulnerabilidade.
- Passos para reproduzir (PoC se possível).
- Impacto esperado (confidencialidade / integridade / disponibilidade).
- Versão / commit afetado.
- Sugestão de mitigação se tiver.

## Nosso compromisso de resposta

| Etapa                             | SLA                  |
| --------------------------------- | -------------------- |
| Confirmação de recebimento        | 48 horas             |
| Avaliação inicial e severidade    | 5 dias úteis         |
| Patch e disclosure coordenado     | 90 dias (CVD padrão) |
| Crédito ao reporter (se desejado) | sempre               |

Para vulnerabilidades críticas (ex: RCE, leak de dados de usuários), trabalhamos em janelas mais curtas (1–14 dias).

## Escopo

Em escopo:

- Código deste repositório (`apps/*`, `packages/*`, `infra/*`).
- Configurações default que distribuímos.

Fora de escopo:

- Vulnerabilidades em dependências de terceiros — reporte ao mantenedor original e nos avise para podermos atualizar.
- Ataques de força bruta contra serviços hospedados sem prova de explorabilidade.
- Engenharia social contra contribuidores.

## Hall of Fame

Pessoas que reportaram vulnerabilidades de forma responsável serão listadas em `docs/SECURITY-HALL-OF-FAME.md` (a menos que prefiram anonimato).
