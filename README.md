# Fake Strava

Planejador de rotas e simulador de atividades no navegador. Você desenha o percurso no mapa, vê distância, tempo estimado e altimetria, e baixa um arquivo GPX para seguir no relógio ou no celular.

[Acesse o Fake Strava](https://mateusfrmacedo.github.io/fake-strava/).

É um site estático (HTML, CSS e JavaScript puro), sem etapa de build e sem servidor próprio.

## O que ele faz

**Montar a rota**

- Clique no mapa para marcar a largada e os próximos pontos. Com "Seguir ruas" ligado, cada trecho acompanha o caminho real, a pé ou de bicicleta conforme a atividade.
- Arraste qualquer ponto para ajustar o caminho.
- Clique em cima da linha para criar um ponto de desvio.
- Clique em um ponto para removê-lo. Clicar na largada fecha o circuito.
- Desenho livre: segure e arraste para riscar o trajeto, que vira pontos editáveis.
- Desfazer e refazer (Ctrl+Z / Ctrl+Shift+Z), fechar circuito, ida e volta, inverter o sentido e limpar.

**Criar automaticamente**

- Na barra do mapa, marque a largada, informe a distância e toque em “Gerar circuito”. Com “Seguir ruas” ligado, a distância é aproximada. Toque de novo para gerar outra opção.
- Formas prontas e texto em traço contínuo, na distância escolhida. Letras e números ficam conectados. As formas e o texto desativam “Seguir ruas” ao serem gerados para preservar o desenho.

**Informações da rota**

- Distância do traçado, subida, descida, altitudes máxima e mínima e parciais estimadas por km.
- Perfil de elevação com dados reais de altimetria; passar o cursor no gráfico mostra o ponto correspondente no mapa.
- Marcadores de quilômetro ao longo do percurso.

**Simular atividade**

- Use a distância e o ganho de elevação do mapa ou preencha esses valores manualmente. Também é possível simular sem traçar uma rota.
- Edite o ritmo ou a velocidade, o tempo em movimento, as calorias, a frequência cardíaca média e a data. Alterar o ritmo recalcula o tempo em movimento, e informar o tempo recalcula o ritmo médio.
- Os campos vazios usam valores automáticos quando houver dados suficientes. As calorias são estimadas com base no peso e na atividade. A frequência cardíaca automática é um valor simulado.
- Escolha entre modalidades a pé, aquáticas, coletivas, de raquete, de inverno, de ciclismo, de força e de dança, ou escreva um nome personalizado. Na natação, o ritmo é exibido em min/100 m.
- Use “Limpar ajustes da simulação” para voltar aos valores automáticos.

- Em “Ritmo e tempo por trecho”, ajuste os quilômetros individualmente. Se você editar o tempo geral da simulação, ele volta a definir o ritmo de todos os trechos.

**Outros recursos**

- Busca de lugares com sugestões enquanto você digita e botão para ir à sua localização.
- Importação de um GPX existente para editar.
- Rascunho salvo automaticamente no navegador.

## Exportação

O botão “Baixar rota GPX” exporta o traçado e a altimetria disponível. Os ajustes por trecho ficam em uma extensão do GPX que o Fake Strava lê ao reimportar o arquivo.

O GPX pode ser importado como rota ou percurso em aplicativos e relógios que aceitam esse formato. O botão “Baixar GPX e abrir Strava Web” baixa o arquivo e abre o criador de rotas, onde você pode selecioná-lo. O nome personalizado fica registrado no GPX.

## Como usar

Abra o `index.html` em um navegador com acesso à internet. Não é preciso instalar nada.

Se preferir servir localmente:

```bash
python3 -m http.server 4173
```

e acesse `http://localhost:4173`.

## Serviços utilizados

O app consulta serviços públicos e gratuitos direto do navegador. Eles têm limites de uso e podem ficar indisponíveis de vez em quando; nesse caso, o trecho afetado fica em linha reta ou a altimetria não aparece.

| Função | Serviço |
| --- | --- |
| Mapa | [Leaflet](https://leafletjs.com/) com blocos do [OpenStreetMap](https://www.openstreetmap.org/copyright) |
| Rotas pelas ruas | OSRM em `routing.openstreetmap.de` (FOSSGIS), com `router.project-osrm.org` como reserva |
| Altimetria | [Open-Meteo Elevation API](https://open-meteo.com/en/docs/elevation-api) |
| Busca de lugares | [Photon](https://photon.komoot.io/), com Nominatim como reserva |

Os dados de mapa são © colaboradores do OpenStreetMap.

## Estrutura

```
index.html   estrutura da página
styles.css   aparência
script.js       mapa, simulação, roteamento, altimetria e exportação
route-design.js formas geométricas e letras para rotas desenhadas
favicon.svg           ícone
logo-fake-strava.webp logo do cabeçalho
```

## Limitações conhecidas

- Com "Seguir ruas" ligado, formas e circuitos automáticos ficam com distância aproximada, pois dependem das ruas disponíveis.
- A altimetria é amostrada em até 100 pontos por rota, então subidas muito curtas podem não aparecer.
- Um GPX importado é simplificado para até 60 pontos editáveis.
