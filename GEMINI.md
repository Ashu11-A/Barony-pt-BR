# Documentação do Processo de Tradução e Correção - Gemini CLI

**Data:** Domingo, 15 de fevereiro de 2026
**Objetivo:** Traduzir e corrigir erros estruturais e de codificação nos arquivos de linguagem, garantindo a integridade técnica e a paridade total com os arquivos originais.
**Versão Atual:** 5.0.1 (Mandatório usar `--version 5.0.1` em todos os comandos)

## 0. Ambiente do Projeto
*   **Sistema Operacional:** Windows (win32).
*   **Restrição de Comandos:** **NUNCA** utilize o operador `&&` para encadear comandos no terminal. Execute comandos de forma individual ou utilizando separadores compatíveis com o ambiente Windows.

## 1. Fluxo de Trabalho (Ciclo de Correção)

Este é o fluxo obrigatório para processamento de traduções em larga escala:

1.  **Auditoria (`verify`):** Execute o comando de auditoria para identificar discrepâncias estruturais, arquivos ausentes ou erros de codificação.
    ```bash
    bun ./manage.ts --version 5.0.1 verify
    ```
2.  **Fluxo de Processamento por Lote (Mandatório):**
    *   **Leitura:** Leia exatamente 100 linhas do arquivo `Check.md` por vez para identificar strings pendentes ou incorretas.
    *   **Geração:** Escreva as traduções no arquivo `translated_batch.txt` seguindo o formato técnico exigido.
    *   **Aplicação:** Execute `bun manage.ts --version 5.0.1 apply` para distribuir as traduções para os arquivos finais.
    *   **Verificação:** Execute `bun manage.ts --version 5.0.1 verify` imediatamente após a aplicação para garantir que nenhuma regra de integridade foi quebrada.

3.  **Análise e Preparação:** 
    *   Leia os problemas listados em `IssuesHighLevel.md`.
    *   Consulte os arquivos originais na pasta `Versions/5.0.1/EN` para obter o contexto e o texto original.
    *   **Importante:** O arquivo `IssuesHighLevel.md` deve ser limpo (ou os itens resolvidos removidos) após a aplicação bem-sucedida dos patches de correção.

3.  **Tradução em Lote (`translated_batch.txt`):** Escreva as correções no arquivo intermediário `translated_batch.txt` seguindo o padrão técnico rigoroso. O formato muda dependendo do tipo de arquivo:

    **Para arquivos .txt (ex: lang/en.txt):**
    ```text
    ---ENTRY START---
    FILE: lang/en.txt
    ID: 6223
    PT-BR: caixote
    ---ENTRY END---
    ```

    **Para arquivos .json:**
    ```text
    ---ENTRY START---
    FILE: data/achievements.json
    PATH: achievements.BARONY_ACH_ENTER_THE_DUNGEON.name
    PT-BR: Entre na Masmorra
    ---ENTRY END---
    ```

4.  **Aplicação (`apply`):** Aplique as traduções acumuladas no lote para os arquivos de destino.
    ```bash
    bun ./manage.ts --version 5.0.1 apply
    ```

## 2. Ferramentas e Scripts (manage.ts)

O script `manage.ts` é o hub central de gerenciamento (O parâmetro `--version <versão>` é obrigatório para todos os comandos):

*   **`lint`**: ✨ O comando mais importante. Realiza a "Limpeza + Normalização + Alinhamento". Força a estrutura do PT-BR a ser idêntica à do EN, preservando apenas os valores traduzidos.
*   **`verify`**: 🛡️ Auditoria ultra-rigorosa que gera o relatório de falhas.
*   **`apply`**: ✅ Processa o `translated_batch.txt` e distribui as traduções nos arquivos corretos.
*   **`identify`**: 🔍 Mapeia quais arquivos realmente contêm texto traduzível humano.
*   **`compare`**: 🔍 Gera `Compared.md` para uma revisão visual completa de todas as traduções lado a lado.
*   **`check`**: 🔍 Analisa arquivos JSON e extrai strings traduzíveis para o `Check.md`. Suporta múltiplos arquivos e pastas (ex: `bun manage.ts --version 5.0.1 check Versions/5.0.1/EN/data`).
*   **`update`**: 🔄 Sincroniza os arquivos da pasta EN com os originais do jogo.

## 3. Fluxo de Revisão Profunda (Quality Assurance)

Para garantir a perfeição da tradução:

1.  **Gerar Comparativo**: `bun ./manage.ts --version 5.0.1 compare`
    *   O script gera o arquivo `Compared.md` listando todas as strings lado a lado (`EN:` e `PT-BR:`).
    *   Abrange todos os arquivos `.json` (percorrendo todos os caminhos) e todos os arquivos `.txt` (incluindo livros).
2.  **Validação Manual**: Abra `Compared.md` e revise as strings.
    *   **Nota:** Devido ao tamanho do arquivo, a revisão deve ser feita em blocos (ex: 100 linhas por vez) para garantir atenção total a cada entrada.
3.  **Filtragem**: Remova as entradas que estão corretas. Deixe apenas as que precisam de ajuste no campo `PT-BR:`.
4.  **Correção**: Mova as entradas restantes para `translated_batch.txt` (ajustando o formato para o padrão técnico de `ENTRY START`) e aplique com `bun ./manage.ts --version 5.0.1 apply`.

## 4. Regras de Integridade

1.  **Paridade de Linhas (Absoluta):** É terminantemente proibido alterar o número total de linhas de qualquer arquivo. O arquivo traduzido deve ser um espelho exato em termos de estrutura de linhas do original. 
    *   **Proibido:** Adicionar quebras de linha extras (`\n`) que resultem em novas linhas físicas no arquivo.
    *   **Proibido:** Remover linhas existentes, mesmo que vazias, se elas existirem no original.
    *   **Consequência:** Qualquer discrepância na contagem de linhas é considerada corrupção crítica e invalidará o arquivo.
2.  **Blacklist de Arquivos:** Arquivos como `ignored_books.json` e `compiled_books.json` são ignorados automaticamente para evitar processamento de dados binários ou irrelevantes.
3.  **Blacklist de Campos (JSON):** Estes campos contêm valores técnicos que **NÃO** devem ser traduzidos para evitar que o jogo trave ou funcione incorretamente:
    *   **Geral:** `img`, `icon`, `path`, `glyph`, `slot`, `internal_name`.
    *   **items/items.json:** `item_category`, `equip_slot`, `school`, `item_id`, `type` (em tooltips).
    *   **data/class_descriptions.json:** `stats` (array de valores qualitativos fixos).
    *   **data/callout_wheel.json:** `action`, `direction`.
4.  **Placeholders:** A ordem e o formato de modificadores como `%s`, `%d`, `%+2d` devem ser preservados exatamente como no original.
5.  **Paridade Estrutural Perfeita:** O arquivo traduzido deve manter paridade estrutural absoluta com o original em inglês. Isso inclui preservar espaços em branco intencionais ao final de strings (trailing spaces) e a ordem exata das chaves.
6.  **Controle de Caracteres Especiais (\r):** É terminantemente proibido o uso de caracteres `\r` (Carriage Return) ou sequências `\r\n` dentro de strings JSON. Use apenas `\n` para quebras de linha internas. O uso de `\r` pode causar falhas críticas no carregamento do jogo.
7.  **Destaques de Palavras (word_highlights):** Em arquivos JSON que utilizam `word_highlights`, os índices devem obrigatoriamente corresponder a palavras existentes no campo `text`. O script `lint` agora corrige isso automaticamente limitando os índices ao tamanho da frase traduzida.

## 5. Notas de Bugs Corrigidos

### Bug Crítico: Crash no Início (Highlight Out-of-Bounds)
*   **Problema:** O jogo travava se um índice em `word_highlights` fosse maior ou igual ao número de palavras na tradução.
*   **Correção:** Implementado limitador automático no `lint` que ajusta os índices para o último índice válido da string traduzida.
*   **Prevenção:** A lógica de sincronização estrutural foi alterada para não sobrescrever arrays numéricos ajustados em PT-BR.

## 6. Comandos Rápidos

*   **Limpeza e Sincronização Total:** `bun manage.ts --version 5.0.1 lint`
*   **Sincronizar com Originais:** `bun manage.ts --version 5.0.1 update`
*   **Auditoria Completa:** `bun manage.ts --version 5.0.1 verify`
*   **Aplicar Lote de Tradução:** `bun manage.ts --version 5.0.1 apply`
*   **Verificar não traduzidos:** `bun manage.ts --version 5.0.1 untranslated`
*   **Gerar Check para Pasta:** `bun manage.ts --version 5.0.1 check Versions/5.0.1/EN/data`