Como publicar e instalar seu Dashboard Financeiro
1. Confira sua planilha
O app espera uma aba chamada "Lançamentos" com estas colunas, nesta ordem, a partir da linha 2:
A (Data)	B (Tipo)	C (Categoria)	D (Descrição)	E (Data de Vencimento)	F (Valor)	G (ID)	H (Status)
04/08/2026	Saídas	Moradia	Energia	05/08/2026	285,28		Pago
Tipo deve ser um de: `Entradas`, `Saídas` ou `Gasto Cartão`.
A coluna H (Status) é nova — o app cria/usa ela para marcar "Pago"/"Pendente" quando você toca no botão dentro do app. Se a sua aba real tiver outro nome (não "Lançamentos"), abra `app.js` e troque o valor de `SHEET_NAME` no topo do arquivo.
Linhas sem "Data de Vencimento" não entram na lista de Contas Fixas — só aparecem em Entradas/Despesas.
2. Suba os arquivos no GitHub Pages (grátis)
Crie uma conta em github.com (se ainda não tiver) e me diga seu nome de usuário — preciso confirmar se ele bate com a "Origem autorizada" que você cadastrou no Google Cloud (`https://SEUUSUARIO.github.io`).
Crie um repositório novo, público, com o nome exatamente: `financeiro` (ou o nome que preferir).
Na página do repositório, clique em "Add file" → "Upload files" e arraste todos os arquivos desta pasta (`index.html`, `style.css`, `app.js`, `manifest.json`, `sw.js` e a pasta `icons`).
Clique em Commit changes.
Vá em Settings → Pages, em "Branch" escolha `main` e pasta `/ (root)`, salve.
Espere 1-2 minutos. Seu app estará em `https://SEUUSUARIO.github.io/financeiro/`.
3. Ajuste a Origem autorizada no Google Cloud
Volte em APIs e serviços → Credenciais, edite seu "ID do cliente OAuth" e confirme que em "Origens JavaScript autorizadas" está exatamente:
`https://SEUUSUARIO.github.io` (sem barra no final, sem o `/financeiro`).
4. Instale no celular
Abra `https://SEUUSUARIO.github.io/financeiro/` no Chrome (Android) ou Safari (iPhone).
Android: toque no menu (⋮) → "Adicionar à tela inicial".
iPhone: toque em Compartilhar → "Adicionar à Tela de Início".
Pronto — abre em tela cheia, com ícone próprio, como um app.
O que ficou combinado
Gasto Cartão NÃO entra no Total de Saídas nem no gráfico de Distribuição de Gastos — ele existe só para você conferir com a fatura. Esses lançamentos aparecem na aba "Despesas" com uma etiqueta "Cartão" e o aviso "não somado no total", mas não afetam nenhum cálculo.
Contas antigas sem nada na coluna Status aparecem como Pendente até você tocar em "Pago" uma vez — a partir daí fica salvo na planilha.
O "mês" mostrado no topo (ex: AGOSTO) é sempre o mês atual do celular/computador, não fixo.
