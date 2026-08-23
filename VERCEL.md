# Deploy na Vercel

O projeto Vercel foi importado quando o repositorio tinha apenas a pasta
`public/`, entao ficou com **Root Directory = `public`**. A Vercel entra
nessa pasta antes de rodar o build.

O `npm run build` continua rodando na raiz do repositorio (o npm sobe a
arvore ate achar o `package.json`), entao o Vite escreve em
`/vercel/path0/dist` normalmente. So a procura pelo diretorio de saida e
que acontece dentro de `public/`. Por isso o `vercel.json` aponta:

    "outputDirectory": "../dist"

Isso resolve para `/vercel/path0/dist`, que e exatamente onde o Vite
escreveu. Funciona igual em preview e em producao.

## Se um dia limpar o Root Directory

Em Settings -> Build and Deployment -> Root Directory, deixando o campo
vazio (raiz do repositorio), o `../dist` passa a apontar para fora do
projeto e o deploy quebra. Nesse caso troque o `vercel.json` de volta
para:

    "outputDirectory": "dist"

## Aviso de allow-scripts

O log de instalacao da Vercel mostra:

    npm warn allow-scripts esbuild@0.28.2 (postinstall: node install.js)

E o npm da Vercel bloqueando scripts de instalacao, nao um problema do
projeto. O esbuild resolve o binario da plataforma por
optionalDependencies, entao o build passa sem o postinstall.
