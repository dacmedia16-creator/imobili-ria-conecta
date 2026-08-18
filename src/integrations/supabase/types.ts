export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          acao: string
          autor_id: string | null
          created_at: string
          id: string
          payload: Json | null
          sale_id: string | null
        }
        Insert: {
          acao: string
          autor_id?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          sale_id?: string | null
        }
        Update: {
          acao?: string
          autor_id?: string | null
          created_at?: string
          id?: string
          payload?: Json | null
          sale_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          cnpj: string | null
          cpf_cnpj: string | null
          cpf_cnpj_normalizado: string | null
          created_at: string
          created_by: string | null
          email: string | null
          endereco: string | null
          id: string
          nome: string | null
          profissao: string | null
          razao_social: string | null
          rg: string | null
          telefone: string | null
          tipo_pessoa: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cnpj?: string | null
          cpf_cnpj?: string | null
          cpf_cnpj_normalizado?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          nome?: string | null
          profissao?: string | null
          razao_social?: string | null
          rg?: string | null
          telefone?: string | null
          tipo_pessoa?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cnpj?: string | null
          cpf_cnpj?: string | null
          cpf_cnpj_normalizado?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          nome?: string | null
          profissao?: string | null
          razao_social?: string | null
          rg?: string | null
          telefone?: string | null
          tipo_pessoa?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      document_extractions: {
        Row: {
          created_at: string
          document_id: string
          error: string | null
          id: string
          raw_json: Json | null
          sale_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_id: string
          error?: string | null
          id?: string
          raw_json?: Json | null
          sale_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_id?: string
          error?: string | null
          id?: string
          raw_json?: Json | null
          sale_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_extractions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "sale_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_extractions_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      metas: {
        Row: {
          corretor_id: string | null
          created_at: string
          created_by: string | null
          id: string
          mes: string
          meta_comissao: number
          team_id: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          corretor_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          mes: string
          meta_comissao: number
          team_id?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          corretor_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          mes?: string
          meta_comissao?: number
          team_id?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "metas_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          lida: boolean
          mensagem: string | null
          sale_id: string | null
          tipo: string
          titulo: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lida?: boolean
          mensagem?: string | null
          sale_id?: string | null
          tipo: string
          titulo: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lida?: boolean
          mensagem?: string | null
          sale_id?: string | null
          tipo?: string
          titulo?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_commissions: {
        Row: {
          created_at: string
          id: string
          managed_by_sale: boolean
          nome: string | null
          occurrence_id: string
          papel: string
          percentual: number | null
          sale_commission_extra_id: string | null
          // Adicionada manualmente (não via codegen) — ver migration
          // 20260817020000_exige_confirmacao_sem_cadastro. Regenerar via `supabase gen types`
          // normalmente assim que a migration rodar.
          sem_cadastro_confirmado: boolean
          user_id: string | null
          valor: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          managed_by_sale?: boolean
          nome?: string | null
          occurrence_id: string
          papel: string
          percentual?: number | null
          sale_commission_extra_id?: string | null
          sem_cadastro_confirmado?: boolean
          user_id?: string | null
          valor?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          managed_by_sale?: boolean
          nome?: string | null
          occurrence_id?: string
          papel?: string
          percentual?: number | null
          sale_commission_extra_id?: string | null
          sem_cadastro_confirmado?: boolean
          user_id?: string | null
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_commissions_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "occurrence_commissions_sale_commission_extra_id_fkey"
            columns: ["sale_commission_extra_id"]
            isOneToOne: false
            referencedRelation: "sale_commission_extras"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrence_partners: {
        Row: {
          agencia: string | null
          banco: string | null
          conta: string | null
          cpf_cnpj: string | null
          created_at: string
          from_sale: boolean
          id: string
          nome: string | null
          occurrence_id: string
          percentual: number | null
          pix: string | null
          tipo: string | null
          valor: number | null
        }
        Insert: {
          agencia?: string | null
          banco?: string | null
          conta?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          from_sale?: boolean
          id?: string
          nome?: string | null
          occurrence_id: string
          percentual?: number | null
          pix?: string | null
          tipo?: string | null
          valor?: number | null
        }
        Update: {
          agencia?: string | null
          banco?: string | null
          conta?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          from_sale?: boolean
          id?: string
          nome?: string | null
          occurrence_id?: string
          percentual?: number | null
          pix?: string | null
          tipo?: string | null
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "occurrence_partners_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "occurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      occurrences: {
        Row: {
          aceita_financeiro: boolean
          aceita_financeiro_em: string | null
          aceita_financeiro_por: string | null
          codigo_imovel: string | null
          created_at: string
          data_assinatura: string | null
          financiamento: boolean | null
          financiamento_banco: string | null
          financiamento_correspondente: string | null
          financiamento_previsao: string | null
          financiamento_valor: number | null
          id: string
          midia: string | null
          nota_fiscal_obrigatoria: boolean | null
          oba_credito: boolean
          observacoes: string | null
          percentual_comissao: number | null
          premio_valor: number | null
          prev_recebimento_data: string | null
          prev_recebimento_forma: string | null
          prev_recebimento_recebido_em: string | null
          prev_recebimento_recebido_valor: number | null
          prev_recebimento_valor: number | null
          prev_recebimento2_data: string | null
          prev_recebimento2_forma: string | null
          prev_recebimento2_recebido_em: string | null
          prev_recebimento2_recebido_valor: number | null
          prev_recebimento2_valor: number | null
          prev_recebimento3_data: string | null
          prev_recebimento3_forma: string | null
          prev_recebimento3_recebido_em: string | null
          prev_recebimento3_recebido_valor: number | null
          prev_recebimento3_valor: number | null
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          sale_id: string
          status: string
          tempo_venda: string | null
          tempo_venda_dias: number | null
          updated_at: string
          valor_anunciado: number | null
          valor_comissao: number | null
          valor_negociado: number | null
        }
        Insert: {
          aceita_financeiro?: boolean
          aceita_financeiro_em?: string | null
          aceita_financeiro_por?: string | null
          codigo_imovel?: string | null
          created_at?: string
          data_assinatura?: string | null
          financiamento?: boolean | null
          financiamento_banco?: string | null
          financiamento_correspondente?: string | null
          financiamento_previsao?: string | null
          financiamento_valor?: number | null
          id?: string
          midia?: string | null
          nota_fiscal_obrigatoria?: boolean | null
          oba_credito?: boolean
          observacoes?: string | null
          percentual_comissao?: number | null
          premio_valor?: number | null
          prev_recebimento_data?: string | null
          prev_recebimento_forma?: string | null
          prev_recebimento_recebido_em?: string | null
          prev_recebimento_recebido_valor?: number | null
          prev_recebimento_valor?: number | null
          prev_recebimento2_data?: string | null
          prev_recebimento2_forma?: string | null
          prev_recebimento2_recebido_em?: string | null
          prev_recebimento2_recebido_valor?: number | null
          prev_recebimento2_valor?: number | null
          prev_recebimento3_data?: string | null
          prev_recebimento3_forma?: string | null
          prev_recebimento3_recebido_em?: string | null
          prev_recebimento3_recebido_valor?: number | null
          prev_recebimento3_valor?: number | null
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          sale_id: string
          status?: string
          tempo_venda?: string | null
          tempo_venda_dias?: number | null
          updated_at?: string
          valor_anunciado?: number | null
          valor_comissao?: number | null
          valor_negociado?: number | null
        }
        Update: {
          aceita_financeiro?: boolean
          aceita_financeiro_em?: string | null
          aceita_financeiro_por?: string | null
          codigo_imovel?: string | null
          created_at?: string
          data_assinatura?: string | null
          financiamento?: boolean | null
          financiamento_banco?: string | null
          financiamento_correspondente?: string | null
          financiamento_previsao?: string | null
          financiamento_valor?: number | null
          id?: string
          midia?: string | null
          nota_fiscal_obrigatoria?: boolean | null
          oba_credito?: boolean
          observacoes?: string | null
          percentual_comissao?: number | null
          premio_valor?: number | null
          prev_recebimento_data?: string | null
          prev_recebimento_forma?: string | null
          prev_recebimento_recebido_em?: string | null
          prev_recebimento_recebido_valor?: number | null
          prev_recebimento_valor?: number | null
          prev_recebimento2_data?: string | null
          prev_recebimento2_forma?: string | null
          prev_recebimento2_recebido_em?: string | null
          prev_recebimento2_recebido_valor?: number | null
          prev_recebimento2_valor?: number | null
          prev_recebimento3_data?: string | null
          prev_recebimento3_forma?: string | null
          prev_recebimento3_recebido_em?: string | null
          prev_recebimento3_recebido_valor?: number | null
          prev_recebimento3_valor?: number | null
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          sale_id?: string
          status?: string
          tempo_venda?: string | null
          tempo_venda_dias?: number | null
          updated_at?: string
          valor_anunciado?: number | null
          valor_comissao?: number | null
          valor_negociado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "occurrences_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: true
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ativo: boolean
          avatar_url: string | null
          created_at: string
          email: string | null
          id: string
          nome: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id: string
          nome?: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      sale_bank_accounts: {
        Row: {
          agencia: string | null
          banco: string | null
          conta: string | null
          created_at: string
          id: string
          parte: string
          pix: string | null
          sale_id: string
          titular: string | null
        }
        Insert: {
          agencia?: string | null
          banco?: string | null
          conta?: string | null
          created_at?: string
          id?: string
          parte: string
          pix?: string | null
          sale_id: string
          titular?: string | null
        }
        Update: {
          agencia?: string | null
          banco?: string | null
          conta?: string | null
          created_at?: string
          id?: string
          parte?: string
          pix?: string | null
          sale_id?: string
          titular?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_bank_accounts_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_comments: {
        Row: {
          autor_id: string
          created_at: string
          doc_id: string | null
          escopo: string
          id: string
          sale_id: string
          texto: string
        }
        Insert: {
          autor_id: string
          created_at?: string
          doc_id?: string | null
          escopo?: string
          id?: string
          sale_id: string
          texto: string
        }
        Update: {
          autor_id?: string
          created_at?: string
          doc_id?: string | null
          escopo?: string
          id?: string
          sale_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_comments_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "sale_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_comments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_commission_extras: {
        Row: {
          created_at: string
          id: string
          nome: string | null
          origem: string
          papel: string | null
          percentual: number | null
          sale_id: string
          // Adicionada manualmente (não via codegen) — ver migration
          // 20260817020000_exige_confirmacao_sem_cadastro. Regenerar via `supabase gen types`
          // normalmente assim que a migration rodar.
          sem_cadastro_confirmado: boolean
          user_id: string | null
          valor: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          nome?: string | null
          origem?: string
          papel?: string | null
          percentual?: number | null
          sale_id: string
          sem_cadastro_confirmado?: boolean
          user_id?: string | null
          valor?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string | null
          origem?: string
          papel?: string | null
          percentual?: number | null
          sale_id?: string
          sem_cadastro_confirmado?: boolean
          user_id?: string | null
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_commission_extras_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_commission_extras_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_documents: {
        Row: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          descricao: string | null
          extraction_status: string
          file_name: string | null
          id: string
          motivo_recusa: string | null
          parte: string
          sale_id: string
          status: Database["public"]["Enums"]["doc_status"]
          storage_path: string | null
          tipo: string
          updated_at: string
          uploaded_by: string | null
          versao: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          descricao?: string | null
          extraction_status?: string
          file_name?: string | null
          id?: string
          motivo_recusa?: string | null
          parte?: string
          sale_id: string
          status?: Database["public"]["Enums"]["doc_status"]
          storage_path?: string | null
          tipo: string
          updated_at?: string
          uploaded_by?: string | null
          versao?: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          descricao?: string | null
          extraction_status?: string
          file_name?: string | null
          id?: string
          motivo_recusa?: string | null
          parte?: string
          sale_id?: string
          status?: Database["public"]["Enums"]["doc_status"]
          storage_path?: string | null
          tipo?: string
          updated_at?: string
          uploaded_by?: string | null
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "sale_documents_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_parties: {
        Row: {
          cliente_id: string | null
          cnpj: string | null
          cpf_cnpj: string | null
          created_at: string
          email: string | null
          endereco: string | null
          id: string
          nome: string | null
          papel: string
          profissao: string | null
          razao_social: string | null
          regime_casamento: string | null
          rg: string | null
          sale_id: string
          telefone: string | null
          tipo_pessoa: string
        }
        Insert: {
          cliente_id?: string | null
          cnpj?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          email?: string | null
          endereco?: string | null
          id?: string
          nome?: string | null
          papel: string
          profissao?: string | null
          razao_social?: string | null
          regime_casamento?: string | null
          rg?: string | null
          sale_id: string
          telefone?: string | null
          tipo_pessoa?: string
        }
        Update: {
          cliente_id?: string | null
          cnpj?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          email?: string | null
          endereco?: string | null
          id?: string
          nome?: string | null
          papel?: string
          profissao?: string | null
          razao_social?: string | null
          regime_casamento?: string | null
          rg?: string | null
          sale_id?: string
          telefone?: string | null
          tipo_pessoa?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_parties_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_parties_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_payment: {
        Row: {
          consorcio_cota: string | null
          consorcio_grupo: string | null
          consorcio_nome: string | null
          entrada_data: string | null
          entrada_valor: number | null
          fgts: boolean | null
          fgts_observacao: string | null
          fgts_valor: number | null
          financiamento: boolean | null
          financiamento_banco: string | null
          financiamento_correspondente: string | null
          financiamento_observacao: string | null
          financiamento_previsao: string | null
          financiamento_valor: number | null
          oba_credito: boolean
          observacoes: string | null
          pagamento_final_data: string | null
          pagamento_final_valor: number | null
          parcela1_data: string | null
          parcela1_valor: number | null
          parcela2_data: string | null
          parcela2_valor: number | null
          sale_id: string
          tipo_pagamento: string
        }
        Insert: {
          consorcio_cota?: string | null
          consorcio_grupo?: string | null
          consorcio_nome?: string | null
          entrada_data?: string | null
          entrada_valor?: number | null
          fgts?: boolean | null
          fgts_observacao?: string | null
          fgts_valor?: number | null
          financiamento?: boolean | null
          financiamento_banco?: string | null
          financiamento_correspondente?: string | null
          financiamento_observacao?: string | null
          financiamento_previsao?: string | null
          financiamento_valor?: number | null
          oba_credito?: boolean
          observacoes?: string | null
          pagamento_final_data?: string | null
          pagamento_final_valor?: number | null
          parcela1_data?: string | null
          parcela1_valor?: number | null
          parcela2_data?: string | null
          parcela2_valor?: number | null
          sale_id: string
          tipo_pagamento?: string
        }
        Update: {
          consorcio_cota?: string | null
          consorcio_grupo?: string | null
          consorcio_nome?: string | null
          entrada_data?: string | null
          entrada_valor?: number | null
          fgts?: boolean | null
          fgts_observacao?: string | null
          fgts_valor?: number | null
          financiamento?: boolean | null
          financiamento_banco?: string | null
          financiamento_correspondente?: string | null
          financiamento_observacao?: string | null
          financiamento_previsao?: string | null
          financiamento_valor?: number | null
          oba_credito?: boolean
          observacoes?: string | null
          pagamento_final_data?: string | null
          pagamento_final_valor?: number | null
          parcela1_data?: string | null
          parcela1_valor?: number | null
          parcela2_data?: string | null
          parcela2_valor?: number | null
          sale_id?: string
          tipo_pagamento?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_payment_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: true
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_status_history: {
        Row: {
          autor_id: string | null
          created_at: string
          de: Database["public"]["Enums"]["sale_status"] | null
          id: string
          motivo: string | null
          para: Database["public"]["Enums"]["sale_status"]
          sale_id: string
        }
        Insert: {
          autor_id?: string | null
          created_at?: string
          de?: Database["public"]["Enums"]["sale_status"] | null
          id?: string
          motivo?: string | null
          para: Database["public"]["Enums"]["sale_status"]
          sale_id: string
        }
        Update: {
          autor_id?: string | null
          created_at?: string
          de?: Database["public"]["Enums"]["sale_status"] | null
          id?: string
          motivo?: string | null
          para?: Database["public"]["Enums"]["sale_status"]
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_status_history_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          codigo_interno: string | null
          comissao_observacoes: string | null
          comissao_quando: string | null
          comissao_valor: number | null
          contrato_libera_assinatura: boolean
          contrato_pendencia_descricao: string | null
          coordenador_id: string | null
          corretor_captador: string | null
          corretor_captador_id: string | null
          corretor_id: string
          corretor_vendedor: string | null
          corretor_vendedor_id: string | null
          created_at: string
          data_assinatura: string | null
          forma_pagamento: string | null
          id: string
          imovel_endereco: string | null
          imovel_id: string | null
          imovel_observacoes: string | null
          indicador: string | null
          indicador_captador: string | null
          indicador_lado: string | null
          indicador_vendedor: string | null
          iptu: string | null
          lider_captador_id: string | null
          lider_captador_nome: string | null
          lider_vendedor_id: string | null
          lider_vendedor_nome: string | null
          matricula: string | null
          midia: string | null
          modalidade: string
          negociacao_observacoes: string | null
          nota_fiscal_obrigatoria: boolean
          parceria_agencia: string | null
          parceria_banco: string | null
          parceria_conta: string | null
          parceria_cpf_cnpj: string | null
          parceria_nome: string | null
          parceria_percentual: number | null
          parceria_pix: string | null
          parceria_tipo: string | null
          parceria_valor: number | null
          percentual_comissao: number | null
          percentual_comissao_captador: number | null
          percentual_comissao_indicador: number | null
          percentual_comissao_vendedor: number | null
          percentual_remax: number | null
          posse_data: string | null
          posse_observacoes: string | null
          premio_valor: number | null
          previsao_recebimento_data: string | null
          previsao_recebimento_forma: string | null
          previsao_recebimento_valor: number | null
          previsao_recebimento2_data: string | null
          previsao_recebimento2_forma: string | null
          previsao_recebimento2_valor: number | null
          previsao_recebimento3_data: string | null
          previsao_recebimento3_forma: string | null
          previsao_recebimento3_valor: number | null
          status: Database["public"]["Enums"]["sale_status"]
          team_leader_id: string | null
          tempo_venda: string | null
          tempo_venda_dias: number | null
          updated_at: string
          valor_anunciado: number | null
          valor_comissao_captador: number | null
          valor_comissao_imobiliaria: number | null
          valor_comissao_indicador: number | null
          valor_comissao_indicador_captador: number | null
          valor_comissao_indicador_vendedor: number | null
          valor_comissao_lider_captador: number | null
          valor_comissao_lider_vendedor: number | null
          valor_comissao_vendedor: number | null
          valor_negociado: number | null
          valor_remax: number | null
          valor_total_comissao: number | null
        }
        Insert: {
          codigo_interno?: string | null
          comissao_observacoes?: string | null
          comissao_quando?: string | null
          comissao_valor?: number | null
          contrato_libera_assinatura?: boolean
          contrato_pendencia_descricao?: string | null
          coordenador_id?: string | null
          corretor_captador?: string | null
          corretor_captador_id?: string | null
          corretor_id: string
          corretor_vendedor?: string | null
          corretor_vendedor_id?: string | null
          created_at?: string
          data_assinatura?: string | null
          forma_pagamento?: string | null
          id?: string
          imovel_endereco?: string | null
          imovel_id?: string | null
          imovel_observacoes?: string | null
          indicador?: string | null
          indicador_captador?: string | null
          indicador_lado?: string | null
          indicador_vendedor?: string | null
          iptu?: string | null
          lider_captador_id?: string | null
          lider_captador_nome?: string | null
          lider_vendedor_id?: string | null
          lider_vendedor_nome?: string | null
          matricula?: string | null
          midia?: string | null
          modalidade?: string
          negociacao_observacoes?: string | null
          nota_fiscal_obrigatoria?: boolean
          parceria_agencia?: string | null
          parceria_banco?: string | null
          parceria_conta?: string | null
          parceria_cpf_cnpj?: string | null
          parceria_nome?: string | null
          parceria_percentual?: number | null
          parceria_pix?: string | null
          parceria_tipo?: string | null
          parceria_valor?: number | null
          percentual_comissao?: number | null
          percentual_comissao_captador?: number | null
          percentual_comissao_indicador?: number | null
          percentual_comissao_vendedor?: number | null
          percentual_remax?: number | null
          posse_data?: string | null
          posse_observacoes?: string | null
          premio_valor?: number | null
          previsao_recebimento_data?: string | null
          previsao_recebimento_forma?: string | null
          previsao_recebimento_valor?: number | null
          previsao_recebimento2_data?: string | null
          previsao_recebimento2_forma?: string | null
          previsao_recebimento2_valor?: number | null
          previsao_recebimento3_data?: string | null
          previsao_recebimento3_forma?: string | null
          previsao_recebimento3_valor?: number | null
          status?: Database["public"]["Enums"]["sale_status"]
          team_leader_id?: string | null
          tempo_venda?: string | null
          tempo_venda_dias?: number | null
          updated_at?: string
          valor_anunciado?: number | null
          valor_comissao_captador?: number | null
          valor_comissao_imobiliaria?: number | null
          valor_comissao_indicador?: number | null
          valor_comissao_indicador_captador?: number | null
          valor_comissao_indicador_vendedor?: number | null
          valor_comissao_lider_captador?: number | null
          valor_comissao_lider_vendedor?: number | null
          valor_comissao_vendedor?: number | null
          valor_negociado?: number | null
          valor_remax?: number | null
          valor_total_comissao?: number | null
        }
        Update: {
          codigo_interno?: string | null
          comissao_observacoes?: string | null
          comissao_quando?: string | null
          comissao_valor?: number | null
          contrato_libera_assinatura?: boolean
          contrato_pendencia_descricao?: string | null
          coordenador_id?: string | null
          corretor_captador?: string | null
          corretor_captador_id?: string | null
          corretor_id?: string
          corretor_vendedor?: string | null
          corretor_vendedor_id?: string | null
          created_at?: string
          data_assinatura?: string | null
          forma_pagamento?: string | null
          id?: string
          imovel_endereco?: string | null
          imovel_id?: string | null
          imovel_observacoes?: string | null
          indicador?: string | null
          indicador_captador?: string | null
          indicador_lado?: string | null
          indicador_vendedor?: string | null
          iptu?: string | null
          lider_captador_id?: string | null
          lider_captador_nome?: string | null
          lider_vendedor_id?: string | null
          lider_vendedor_nome?: string | null
          matricula?: string | null
          midia?: string | null
          modalidade?: string
          negociacao_observacoes?: string | null
          nota_fiscal_obrigatoria?: boolean
          parceria_agencia?: string | null
          parceria_banco?: string | null
          parceria_conta?: string | null
          parceria_cpf_cnpj?: string | null
          parceria_nome?: string | null
          parceria_percentual?: number | null
          parceria_pix?: string | null
          parceria_tipo?: string | null
          parceria_valor?: number | null
          percentual_comissao?: number | null
          percentual_comissao_captador?: number | null
          percentual_comissao_indicador?: number | null
          percentual_comissao_vendedor?: number | null
          percentual_remax?: number | null
          posse_data?: string | null
          posse_observacoes?: string | null
          premio_valor?: number | null
          previsao_recebimento_data?: string | null
          previsao_recebimento_forma?: string | null
          previsao_recebimento_valor?: number | null
          previsao_recebimento2_data?: string | null
          previsao_recebimento2_forma?: string | null
          previsao_recebimento2_valor?: number | null
          previsao_recebimento3_data?: string | null
          previsao_recebimento3_forma?: string | null
          previsao_recebimento3_valor?: number | null
          status?: Database["public"]["Enums"]["sale_status"]
          team_leader_id?: string | null
          tempo_venda?: string | null
          tempo_venda_dias?: number | null
          updated_at?: string
          valor_anunciado?: number | null
          valor_comissao_captador?: number | null
          valor_comissao_imobiliaria?: number | null
          valor_comissao_indicador?: number | null
          valor_comissao_indicador_captador?: number | null
          valor_comissao_indicador_vendedor?: number | null
          valor_comissao_lider_captador?: number | null
          valor_comissao_lider_vendedor?: number | null
          valor_comissao_vendedor?: number | null
          valor_negociado?: number | null
          valor_remax?: number | null
          valor_total_comissao?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_lider_captador_id_fkey"
            columns: ["lider_captador_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_lider_vendedor_id_fkey"
            columns: ["lider_vendedor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      team_co_leaders: {
        Row: {
          created_at: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_co_leaders_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          membro_id: string
          team_id: string
          tipo: string
        }
        Insert: {
          created_at?: string
          id?: string
          membro_id: string
          team_id: string
          tipo?: string
        }
        Update: {
          created_at?: string
          id?: string
          membro_id?: string
          team_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          cor: string
          created_at: string
          id: string
          lider_id: string
          nome: string
          parent_team_id: string | null
          updated_at: string
        }
        Insert: {
          cor?: string
          created_at?: string
          id?: string
          lider_id: string
          nome?: string
          parent_team_id?: string | null
          updated_at?: string
        }
        Update: {
          cor?: string
          created_at?: string
          id?: string
          lider_id?: string
          nome?: string
          parent_team_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_parent_team_id_fkey"
            columns: ["parent_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          notificar_toda_atualizacao: boolean
          notificar_whatsapp: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notificar_toda_atualizacao?: boolean
          notificar_whatsapp?: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notificar_toda_atualizacao?: boolean
          notificar_whatsapp?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      archive_sale_document: {
        Args: { _document_id: string }
        Returns: undefined
      }
      calcular_distribuicao_venda:
        | {
            Args: { p_sale: Database["public"]["Tables"]["sales"]["Row"] }
            Returns: Json
          }
        | { Args: { p_sale_id: string }; Returns: Json }
      can_edit_sale_comissao: {
        Args: { _sale_id: string; _user: string }
        Returns: boolean
      }
      can_edit_sale_stage: {
        Args: { _sale_id: string; _user: string }
        Returns: boolean
      }
      can_view_sale: {
        Args: { _sale_id: string; _user: string }
        Returns: boolean
      }
      change_sale_status: {
        Args: { _motivo?: string; _new_status: string; _sale_id: string }
        Returns: undefined
      }
      cliente_historico: {
        Args: { _cliente_id: string; _excluir_sale_id?: string }
        Returns: {
          data: string
          imovel_endereco: string
          imovel_id: string
          papel: string
          sale_id: string
        }[]
      }
      criar_ocorrencia_completa: { Args: { p_sale_id: string }; Returns: Json }
      // Entrada adicionada manualmente (não via codegen). Regenerar via `supabase gen types`
      // normalmente na próxima oportunidade — o codegen substitui esta entrada por uma
      // equivalente, e este comentário some junto.
      criar_lancamento: {
        Args: { p_construtora_cnpj: string; p_construtora_nome: string; p_imovel_id: string }
        Returns: string
      }
      // Entrada adicionada manualmente (não via codegen). Regenerar via `supabase gen types`
      // normalmente na próxima oportunidade — o codegen substitui esta entrada por uma
      // equivalente, e este comentário some junto.
      concluir_lancamento: {
        Args: { p_sale_id: string; p_saldo_confirmado: number }
        Returns: Json
      }
      criar_ocorrencia_lancamento: {
        Args: { p_sale_id: string }
        Returns: Json
      }
      // Entrada adicionada manualmente (não via codegen). Regenerar via `supabase gen types`
      // normalmente na próxima oportunidade — o codegen substitui esta entrada por uma
      // equivalente, e este comentário some junto.
      dashboard_movimentacao_periodo: {
        Args: { _fim: string; _inicio: string }
        Returns: Json
      }
      dashboard_stats: { Args: never; Returns: Json }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      insert_sale_document: {
        Args: {
          _descricao?: string
          _extraction_status?: string
          _file_name: string
          _parte: string
          _sale_id: string
          _status?: Database["public"]["Enums"]["doc_status"]
          _storage_path: string
          _tipo: string
        }
        Returns: {
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          descricao: string | null
          extraction_status: string
          file_name: string | null
          id: string
          motivo_recusa: string | null
          parte: string
          sale_id: string
          status: Database["public"]["Enums"]["doc_status"]
          storage_path: string | null
          tipo: string
          updated_at: string
          uploaded_by: string | null
          versao: number
        }
        SetofOptions: {
          from: "*"
          to: "sale_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_active_user: { Args: { _user: string }; Returns: boolean }
      is_lead_of: {
        Args: { _lider: string; _membro: string }
        Returns: boolean
      }
      is_sale_locked: { Args: { _sale_id: string }; Returns: boolean }
      leads_team_or_parent: {
        Args: { _team_id: string; _user: string }
        Returns: boolean
      }
      list_active_corretores: {
        Args: never
        Returns: {
          id: string
          nome: string
        }[]
      }
      list_active_gestores: {
        Args: never
        Returns: {
          id: string
          nome: string
        }[]
      }
      list_active_team_leaders: {
        Args: never
        Returns: {
          id: string
          nome: string
        }[]
      }
      metas_progresso: { Args: { _mes: string }; Returns: Json }
      // Entrada adicionada manualmente (não via codegen). Regenerar via `supabase gen types`
      // normalmente na próxima oportunidade — o codegen substitui esta entrada por uma
      // equivalente, e este comentário some junto.
      salvar_divisao_comissao_lancamento: {
        Args: { p_linhas: Json; p_sale_id: string }
        Returns: Json
      }
      sees_own_team_leader: {
        Args: { _profile_id: string; _user: string }
        Returns: boolean
      }
      sees_team: { Args: { _team_id: string; _user: string }; Returns: boolean }
      sync_occurrence_commissions: {
        Args: { _sale_id: string }
        Returns: undefined
      }
      update_contrato_pendencia: {
        Args: {
          _libera_assinatura: boolean
          _pendencia_descricao: string
          _sale_id: string
        }
        Returns: undefined
      }
      visao_executiva_detalhe_comissao: {
        Args: {
          _corretor_id?: string | null
          _sem_equipe?: boolean
          _team_id?: string | null
        }
        Returns: Json
      }
      visao_executiva_stats: { Args: never; Returns: Json }
    }
    Enums: {
      app_role:
        | "corretor"
        | "coordenador"
        | "gestor"
        | "juridico"
        | "financeiro"
        | "admin"
        | "super_admin"
        | "team_leader"
        | "lancamento"
      doc_status: "pendente" | "enviado" | "aprovado" | "recusado"
      sale_status:
        | "rascunho"
        | "enviada_revisao"
        | "devolvida_ajuste"
        | "aprovada_gestor"
        | "enviada_juridico"
        | "em_elaboracao_contrato"
        | "aguardando_assinatura"
        | "contrato_assinado"
        | "ocorrencia_pendente"
        | "ocorrencia_concluida"
        | "arquivada"
        | "cancelada"
        | "contrato_conferencia_gestor"
        | "contrato_conferencia_corretor"
        | "contrato_ok_corretor"
        | "ocorrencia_analise_financeiro"
        | "ocorrencia_devolvida_gestor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "corretor",
        "coordenador",
        "gestor",
        "juridico",
        "financeiro",
        "admin",
        "super_admin",
        "team_leader",
        "lancamento",
      ],
      doc_status: ["pendente", "enviado", "aprovado", "recusado"],
      sale_status: [
        "rascunho",
        "enviada_revisao",
        "devolvida_ajuste",
        "aprovada_gestor",
        "enviada_juridico",
        "em_elaboracao_contrato",
        "aguardando_assinatura",
        "contrato_assinado",
        "ocorrencia_pendente",
        "ocorrencia_concluida",
        "arquivada",
        "cancelada",
        "contrato_conferencia_gestor",
        "contrato_conferencia_corretor",
        "contrato_ok_corretor",
        "ocorrencia_analise_financeiro",
        "ocorrencia_devolvida_gestor",
      ],
    },
  },
} as const
