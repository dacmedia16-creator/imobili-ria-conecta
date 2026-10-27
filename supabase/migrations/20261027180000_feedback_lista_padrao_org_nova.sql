-- t_57750424 — Lista padrão do Feedback / Plano de Marketing para TODA imobiliária NOVA
-- (pedido de Denis em 27/10/2026, tópico 6238). PREPARADA, NÃO aplicada; só publica com o "sim" de Denis.
--
-- Problema: owner_feedback_actions é por imobiliária e nascia vazia. Com o módulo feedback_proprietario
-- ligado, a tela do Plano de Marketing mostrava "A lista de ações não está disponível...".
-- Em 27/10 as 6 imobiliárias vazias receberam uma cópia manual (55 ações) da Única Escolha.
--
-- O que esta migration faz:
--  1. Função owner_feedback_lista_padrao_copiar(org): grava a lista padrão (55 ações: 33 'marketing' +
--     22 'checklist') na imobiliária, SÓ se ela ainda não tiver nenhuma ação (idempotente; nunca mexe
--     em lista existente nem duplica). Devolve quantas linhas gravou.
--     A lista fica FIXA aqui (cópia conferida da Única Escolha em 27/10, sem nada específico dela:
--     nada de Sorocaba, pessoa, fornecedor ou canal exclusivo). Editar a lista de uma imobiliária
--     depois não muda o padrão.
--  2. Gatilho AFTER INSERT em organizations chama a função. Se falhar, só registra aviso e a criação
--     da imobiliária segue normalmente (não bloqueia cadastro/convite).
-- Não mexe em nenhuma imobiliária existente. Não muda RLS nem a tela.
-- Desfazer: supabase/rollback/20261027180000_feedback_lista_padrao_org_nova.sql (remove gatilho e função; as
-- listas já gravadas ficam, pois a imobiliária pode tê-las usado).
BEGIN;

CREATE OR REPLACE FUNCTION public.owner_feedback_lista_padrao_copiar(p_org uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer := 0;
BEGIN
  IF p_org IS NULL OR NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org) THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM public.owner_feedback_actions WHERE organization_id = p_org) THEN
    RETURN 0;
  END IF;
  INSERT INTO public.owner_feedback_actions (organization_id, list, category, label, weight, sort, active)
  SELECT p_org, v.list, v.category, v.label, v.weight, v.sort, true
    FROM (VALUES
      ('checklist', 'Etapa 1 · V1 — 1ª visita ao proprietário', 'Ouvir mais e falar menos (perguntas abertas e fechadas)', NULL, 101),
      ('checklist', 'Etapa 1 · V1 — 1ª visita ao proprietário', 'Entregar dossiê pessoal', NULL, 102),
      ('checklist', 'Etapa 1 · V1 — 1ª visita ao proprietário', 'Gerar conexão e apresentação breve sobre a RE/MAX', NULL, 103),
      ('checklist', 'Etapa 1 · V1 — 1ª visita ao proprietário', 'Cadastro inicial do imóvel (físico ou digital)', NULL, 104),
      ('checklist', 'Etapa 1 · V1 — 1ª visita ao proprietário', 'Entender necessidades do proprietário (o porquê? Quanto tempo está à venda?)', NULL, 105),
      ('checklist', 'Etapa 1 · V1 — 1ª visita ao proprietário', 'Alinhar expectativas da venda (valor, condição e tempo de venda)', NULL, 106),
      ('checklist', 'Etapa 1 · V1 — 1ª visita ao proprietário', 'Reconhecimento detalhado e inspeção técnica do imóvel', NULL, 107),
      ('checklist', 'Etapa 1 · V1 — 1ª visita ao proprietário', 'Fazer fotos iniciais do imóvel', NULL, 108),
      ('checklist', 'Etapa 1 · V1 — 1ª visita ao proprietário', 'Foto do IPTU e matrícula', NULL, 109),
      ('checklist', 'Etapa 1 · V1 — 1ª visita ao proprietário', 'Sair da V1 com a V2 agendada (máximo dois dias)', NULL, 110),
      ('checklist', 'Etapa 2 · Preparação da V2', 'Conferir e conciliar dados de IPTU com matrícula', NULL, 201),
      ('checklist', 'Etapa 2 · Preparação da V2', 'Elaborar Estudo de Mercado', NULL, 202),
      ('checklist', 'Etapa 2 · Preparação da V2', 'Elaborar Plano de Marketing', NULL, 203),
      ('checklist', 'Etapa 2 · Preparação da V2', 'Preparar apresentação', NULL, 204),
      ('checklist', 'Etapa 3 · V2 — Apresentação do estudo (ACM)', 'Apresentar dossiê RE/MAX', NULL, 301),
      ('checklist', 'Etapa 3 · V2 — Apresentação do estudo (ACM)', 'Identificar e isolar objeções', NULL, 302),
      ('checklist', 'Etapa 3 · V2 — Apresentação do estudo (ACM)', 'Apresentar condições e vantagens do modelo RE/MAX', NULL, 303),
      ('checklist', 'Etapa 3 · V2 — Apresentação do estudo (ACM)', 'Apresentar ACM', NULL, 304),
      ('checklist', 'Etapa 3 · V2 — Apresentação do estudo (ACM)', 'Definir preço junto ao proprietário (não pegar fora de preço)', NULL, 305),
      ('checklist', 'Etapa 3 · V2 — Apresentação do estudo (ACM)', 'Solicitar documentos pessoais para o contrato (RG, CPF, certidão de estado civil, e-mail e telefone)', NULL, 306),
      ('checklist', 'Etapa 3 · V2 — Apresentação do estudo (ACM)', 'Assinar contrato de gestão RE/MAX (entregar cópia)', NULL, 307),
      ('checklist', 'Etapa 3 · V2 — Apresentação do estudo (ACM)', 'Assinar plano de marketing RE/MAX (entregar cópia)', NULL, 308),
      ('marketing', 'Foto e vídeo / produção visual', 'Aplicar tratamento profissional nas imagens', 'vital', 101),
      ('marketing', 'Foto e vídeo / produção visual', 'Produzir fotos profissionais', 'vital', 102),
      ('marketing', 'Foto e vídeo / produção visual', 'Produzir Reels de lançamento do imóvel', 'vital', 103),
      ('marketing', 'Foto e vídeo / produção visual', 'Produzir tour virtual 360º', 'vital', 104),
      ('marketing', 'Foto e vídeo / produção visual', 'Produzir vídeos curtos', 'vital', 105),
      ('marketing', 'Foto e vídeo / produção visual', 'Produzir vídeos profissionais', 'vital', 106),
      ('marketing', 'Conteúdo e materiais', 'Criar anúncio do imóvel para WhatsApp', 'vital', 201),
      ('marketing', 'Conteúdo e materiais', 'Desenvolver descrição estratégica do imóvel', 'vital', 202),
      ('marketing', 'Conteúdo e materiais', 'Desenvolver texto descritivo otimizado', 'vital', 203),
      ('marketing', 'Conteúdo e materiais', 'Produzir ficha técnica do imóvel', 'vital', 204),
      ('marketing', 'Portais, CRM e distribuição', 'Publicar no site RE/MAX Brasil', 'vital', 301),
      ('marketing', 'Portais, CRM e distribuição', 'Publicar no site RE/MAX Global', 'vital', 302),
      ('marketing', 'Portais, CRM e distribuição', 'Publicar Portal: Canal Pro (ZAP, Viva Real e OLX)', 'vital', 303),
      ('marketing', 'Portais, CRM e distribuição', 'Publicar Portal: Casa Mineira', 'importante', 304),
      ('marketing', 'Portais, CRM e distribuição', 'Publicar Portal: Chaves na Mão', 'importante', 305),
      ('marketing', 'Portais, CRM e distribuição', 'Publicar Portal: Imóvel Web', 'importante', 306),
      ('marketing', 'Portais, CRM e distribuição', 'Publicar tour virtual no site', 'importante', 307),
      ('marketing', 'Portais, CRM e distribuição', 'Divulgar no site próprio do corretor', 'importante', 308),
      ('marketing', 'Otimização de anúncios', 'Aplicar destaque e super destaque nos portais', 'vital', 401),
      ('marketing', 'Otimização de anúncios', 'Atualizar imagens conforme estratégia', 'importante', 402),
      ('marketing', 'Otimização de anúncios', 'Editar anúncios existentes', 'vital', 403),
      ('marketing', 'Otimização de anúncios', 'Renovar anúncios', 'vital', 404),
      ('marketing', 'Otimização de anúncios', 'Reorganizar fotos principais', 'importante', 405),
      ('marketing', 'Otimização de anúncios', 'Trocar capas de anúncios', 'importante', 406),
      ('marketing', 'Redes sociais', 'Produzir para Instagram (Stories, feed e Reels)', 'vital', 501),
      ('marketing', 'Redes sociais', 'Publicar no Facebook', 'importante', 502),
      ('marketing', 'Redes sociais', 'Publicar no LinkedIn', 'importante', 503),
      ('marketing', 'Divulgação offline e presença local', 'Instalar placa RE/MAX', 'vital', 601),
      ('marketing', 'Parcerias e distribuição ativa', 'Enviar semanalmente o imóvel em grupos de WhatsApp', 'vital', 701),
      ('marketing', 'Parcerias e distribuição ativa', 'Compartilhar com a rede RE/MAX', 'vital', 702),
      ('marketing', 'Parcerias e distribuição ativa', 'Desenvolver parcerias com influenciadores', 'complementar', 703),
      ('marketing', 'Reuniões estratégicas e ajustes', 'Avaliar e apresentar todas as propostas ao proprietário', 'vital', 801),
      ('marketing', 'Reuniões estratégicas e ajustes', 'Avaliar resultado das ações — redirecionar para o que funciona', 'vital', 802)
    ) AS v(list, category, label, weight, sort)
  ON CONFLICT (organization_id, list, category, label) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.owner_feedback_lista_padrao_copiar(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.owner_feedback_lista_padrao_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    PERFORM public.owner_feedback_lista_padrao_copiar(NEW.id);
  EXCEPTION WHEN others THEN
    RAISE WARNING 'owner_feedback_lista_padrao_trg falhou: %', SQLERRM;
  END;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.owner_feedback_lista_padrao_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_zz_feedback_lista_padrao ON public.organizations;
CREATE TRIGGER trg_zz_feedback_lista_padrao AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.owner_feedback_lista_padrao_trg();

COMMIT;
