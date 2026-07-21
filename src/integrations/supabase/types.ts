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
          nome: string | null
          occurrence_id: string
          papel: string
          percentual: number | null
          sale_commission_extra_id: string | null
          valor: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          nome?: string | null
          occurrence_id: string
          papel: string
          percentual?: number | null
          sale_commission_extra_id?: string | null
          valor?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string | null
          occurrence_id?: string
          papel?: string
          percentual?: number | null
          sale_commission_extra_id?: string | null
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
          id: string
          nome: string | null
          occurrence_id: string
          percentual: number | null
          valor: number | null
        }
        Insert: {
          agencia?: string | null
          banco?: string | null
          conta?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          id?: string
          nome?: string | null
          occurrence_id: string
          percentual?: number | null
          valor?: number | null
        }
        Update: {
          agencia?: string | null
          banco?: string | null
          conta?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          id?: string
          nome?: string | null
          occurrence_id?: string
          percentual?: number | null
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
          observacoes: string | null
          percentual_comissao: number | null
          prev_recebimento_data: string | null
          prev_recebimento_forma: string | null
          prev_recebimento_valor: number | null
          prev_recebimento2_data: string | null
          prev_recebimento2_forma: string | null
          prev_recebimento2_valor: number | null
          prev_recebimento3_data: string | null
          prev_recebimento3_forma: string | null
          prev_recebimento3_valor: number | null
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          sale_id: string
          status: string
          tempo_venda: string | null
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
          observacoes?: string | null
          percentual_comissao?: number | null
          prev_recebimento_data?: string | null
          prev_recebimento_forma?: string | null
          prev_recebimento_valor?: number | null
          prev_recebimento2_data?: string | null
          prev_recebimento2_forma?: string | null
          prev_recebimento2_valor?: number | null
          prev_recebimento3_data?: string | null
          prev_recebimento3_forma?: string | null
          prev_recebimento3_valor?: number | null
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          sale_id: string
          status?: string
          tempo_venda?: string | null
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
          observacoes?: string | null
          percentual_comissao?: number | null
          prev_recebimento_data?: string | null
          prev_recebimento_forma?: string | null
          prev_recebimento_valor?: number | null
          prev_recebimento2_data?: string | null
          prev_recebimento2_forma?: string | null
          prev_recebimento2_valor?: number | null
          prev_recebimento3_data?: string | null
          prev_recebimento3_forma?: string | null
          prev_recebimento3_valor?: number | null
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          sale_id?: string
          status?: string
          tempo_venda?: string | null
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
          created_at: string
          email: string | null
          id: string
          nome: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          email?: string | null
          id: string
          nome?: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
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
        ]
      }
      sale_documents: {
        Row: {
          created_at: string
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
          cpf_cnpj: string | null
          created_at: string
          email: string | null
          endereco: string | null
          id: string
          nome: string | null
          papel: string
          profissao: string | null
          rg: string | null
          sale_id: string
          telefone: string | null
        }
        Insert: {
          cpf_cnpj?: string | null
          created_at?: string
          email?: string | null
          endereco?: string | null
          id?: string
          nome?: string | null
          papel: string
          profissao?: string | null
          rg?: string | null
          sale_id: string
          telefone?: string | null
        }
        Update: {
          cpf_cnpj?: string | null
          created_at?: string
          email?: string | null
          endereco?: string | null
          id?: string
          nome?: string | null
          papel?: string
          profissao?: string | null
          rg?: string | null
          sale_id?: string
          telefone?: string | null
        }
        Relationships: [
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
          entrada_data: string | null
          entrada_valor: number | null
          fgts: boolean | null
          fgts_observacao: string | null
          fgts_valor: number | null
          financiamento: boolean | null
          financiamento_banco: string | null
          financiamento_observacao: string | null
          financiamento_valor: number | null
          observacoes: string | null
          parcela1_data: string | null
          parcela1_valor: number | null
          parcela2_data: string | null
          parcela2_valor: number | null
          sale_id: string
        }
        Insert: {
          entrada_data?: string | null
          entrada_valor?: number | null
          fgts?: boolean | null
          fgts_observacao?: string | null
          fgts_valor?: number | null
          financiamento?: boolean | null
          financiamento_banco?: string | null
          financiamento_observacao?: string | null
          financiamento_valor?: number | null
          observacoes?: string | null
          parcela1_data?: string | null
          parcela1_valor?: number | null
          parcela2_data?: string | null
          parcela2_valor?: number | null
          sale_id: string
        }
        Update: {
          entrada_data?: string | null
          entrada_valor?: number | null
          fgts?: boolean | null
          fgts_observacao?: string | null
          fgts_valor?: number | null
          financiamento?: boolean | null
          financiamento_banco?: string | null
          financiamento_observacao?: string | null
          financiamento_valor?: number | null
          observacoes?: string | null
          parcela1_data?: string | null
          parcela1_valor?: number | null
          parcela2_data?: string | null
          parcela2_valor?: number | null
          sale_id?: string
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
          coordenador_id: string | null
          corretor_captador: string | null
          corretor_id: string
          corretor_vendedor: string | null
          created_at: string
          forma_pagamento: string | null
          id: string
          imovel_id: string | null
          imovel_observacoes: string | null
          indicador: string | null
          indicador_lado: string | null
          iptu: string | null
          matricula: string | null
          negociacao_observacoes: string | null
          percentual_comissao: number | null
          percentual_comissao_captador: number | null
          percentual_comissao_indicador: number | null
          percentual_comissao_vendedor: number | null
          posse_data: string | null
          posse_observacoes: string | null
          status: Database["public"]["Enums"]["sale_status"]
          team_leader_id: string | null
          updated_at: string
          valor_anunciado: number | null
          valor_comissao_captador: number | null
          valor_comissao_imobiliaria: number | null
          valor_comissao_indicador: number | null
          valor_comissao_vendedor: number | null
          valor_negociado: number | null
          valor_total_comissao: number | null
        }
        Insert: {
          codigo_interno?: string | null
          comissao_observacoes?: string | null
          comissao_quando?: string | null
          comissao_valor?: number | null
          coordenador_id?: string | null
          corretor_captador?: string | null
          corretor_id: string
          corretor_vendedor?: string | null
          created_at?: string
          forma_pagamento?: string | null
          id?: string
          imovel_id?: string | null
          imovel_observacoes?: string | null
          indicador?: string | null
          indicador_lado?: string | null
          iptu?: string | null
          matricula?: string | null
          negociacao_observacoes?: string | null
          percentual_comissao?: number | null
          percentual_comissao_captador?: number | null
          percentual_comissao_indicador?: number | null
          percentual_comissao_vendedor?: number | null
          posse_data?: string | null
          posse_observacoes?: string | null
          status?: Database["public"]["Enums"]["sale_status"]
          team_leader_id?: string | null
          updated_at?: string
          valor_anunciado?: number | null
          valor_comissao_captador?: number | null
          valor_comissao_imobiliaria?: number | null
          valor_comissao_indicador?: number | null
          valor_comissao_vendedor?: number | null
          valor_negociado?: number | null
          valor_total_comissao?: number | null
        }
        Update: {
          codigo_interno?: string | null
          comissao_observacoes?: string | null
          comissao_quando?: string | null
          comissao_valor?: number | null
          coordenador_id?: string | null
          corretor_captador?: string | null
          corretor_id?: string
          corretor_vendedor?: string | null
          created_at?: string
          forma_pagamento?: string | null
          id?: string
          imovel_id?: string | null
          imovel_observacoes?: string | null
          indicador?: string | null
          indicador_lado?: string | null
          iptu?: string | null
          matricula?: string | null
          negociacao_observacoes?: string | null
          percentual_comissao?: number | null
          percentual_comissao_captador?: number | null
          percentual_comissao_indicador?: number | null
          percentual_comissao_vendedor?: number | null
          posse_data?: string | null
          posse_observacoes?: string | null
          status?: Database["public"]["Enums"]["sale_status"]
          team_leader_id?: string | null
          updated_at?: string
          valor_anunciado?: number | null
          valor_comissao_captador?: number | null
          valor_comissao_imobiliaria?: number | null
          valor_comissao_indicador?: number | null
          valor_comissao_vendedor?: number | null
          valor_negociado?: number | null
          valor_total_comissao?: number | null
        }
        Relationships: []
      }
      team_members: {
        Row: {
          created_at: string
          id: string
          lider_id: string
          membro_id: string
          tipo: string
        }
        Insert: {
          created_at?: string
          id?: string
          lider_id: string
          membro_id: string
          tipo?: string
        }
        Update: {
          created_at?: string
          id?: string
          lider_id?: string
          membro_id?: string
          tipo?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
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
      can_view_sale: {
        Args: { _sale_id: string; _user: string }
        Returns: boolean
      }
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
      is_lead_of: {
        Args: { _lider: string; _membro: string }
        Returns: boolean
      }
      is_sale_locked: { Args: { _sale_id: string }; Returns: boolean }
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
