export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      activity_logs: {
        Row: {
          acao: string;
          autor_id: string | null;
          created_at: string;
          id: string;
          organization_id: string;
          payload: Json | null;
          sale_id: string | null;
        };
        Insert: {
          acao: string;
          autor_id?: string | null;
          created_at?: string;
          id?: string;
          organization_id?: string;
          payload?: Json | null;
          sale_id?: string | null;
        };
        Update: {
          acao?: string;
          autor_id?: string | null;
          created_at?: string;
          id?: string;
          organization_id?: string;
          payload?: Json | null;
          sale_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "activity_logs_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_logs_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mt_1b_activity_logs_autor_id_org_fk";
            columns: ["autor_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_activity_logs_sale_id_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      clientes: {
        Row: {
          cnpj: string | null;
          cpf_cnpj: string | null;
          cpf_cnpj_normalizado: string | null;
          created_at: string;
          created_by: string | null;
          email: string | null;
          endereco: string | null;
          id: string;
          nome: string | null;
          organization_id: string;
          profissao: string | null;
          razao_social: string | null;
          rg: string | null;
          telefone: string | null;
          tipo_pessoa: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          cnpj?: string | null;
          cpf_cnpj?: string | null;
          cpf_cnpj_normalizado?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          endereco?: string | null;
          id?: string;
          nome?: string | null;
          organization_id?: string;
          profissao?: string | null;
          razao_social?: string | null;
          rg?: string | null;
          telefone?: string | null;
          tipo_pessoa?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          cnpj?: string | null;
          cpf_cnpj?: string | null;
          cpf_cnpj_normalizado?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          endereco?: string | null;
          id?: string;
          nome?: string | null;
          organization_id?: string;
          profissao?: string | null;
          razao_social?: string | null;
          rg?: string | null;
          telefone?: string | null;
          tipo_pessoa?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "clientes_organization_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      conta_max_identity_links: {
        Row: {
          active: boolean;
          adm_user_id: string;
          created_at: string;
          id: string;
          revoked_at: string | null;
          workos_user_id: string;
        };
        Insert: {
          active?: boolean;
          adm_user_id: string;
          created_at?: string;
          id?: string;
          revoked_at?: string | null;
          workos_user_id: string;
        };
        Update: {
          active?: boolean;
          adm_user_id?: string;
          created_at?: string;
          id?: string;
          revoked_at?: string | null;
          workos_user_id?: string;
        };
        Relationships: [];
      };
      conta_max_ticket_uses: {
        Row: {
          expires_at: string;
          jti: string;
          used_at: string;
        };
        Insert: {
          expires_at: string;
          jti: string;
          used_at?: string;
        };
        Update: {
          expires_at?: string;
          jti?: string;
          used_at?: string;
        };
        Relationships: [];
      };
      corretor_positioning_regions: {
        Row: {
          corretor_id: string;
          created_at: string;
          organization_id: string;
          region_id: number;
        };
        Insert: {
          corretor_id: string;
          created_at?: string;
          organization_id?: string;
          region_id: number;
        };
        Update: {
          corretor_id?: string;
          created_at?: string;
          organization_id?: string;
          region_id?: number;
        };
        Relationships: [
          {
            foreignKeyName: "corretor_positioning_regions_corretor_id_fkey";
            columns: ["corretor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "corretor_positioning_regions_corretor_org_fk";
            columns: ["corretor_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "corretor_positioning_regions_region_id_fkey";
            columns: ["region_id"];
            isOneToOne: false;
            referencedRelation: "positioning_regions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "corretor_positioning_regions_region_org_fk";
            columns: ["region_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "positioning_regions";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      document_extractions: {
        Row: {
          created_at: string;
          document_id: string;
          error: string | null;
          id: string;
          organization_id: string;
          raw_json: Json | null;
          sale_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          document_id: string;
          error?: string | null;
          id?: string;
          organization_id?: string;
          raw_json?: Json | null;
          sale_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          document_id?: string;
          error?: string | null;
          id?: string;
          organization_id?: string;
          raw_json?: Json | null;
          sale_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_extractions_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: true;
            referencedRelation: "sale_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_extractions_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "document_extractions_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mt_1b_document_extractions_document_id_org_fk";
            columns: ["document_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sale_documents";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_document_extractions_sale_id_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      exclusive_capture_setting_history: {
        Row: {
          action: string;
          actor_id: string;
          changed_at: string;
          id: string;
          organization_id: string;
        };
        Insert: {
          action: string;
          actor_id: string;
          changed_at?: string;
          id?: string;
          organization_id?: string;
        };
        Update: {
          action?: string;
          actor_id?: string;
          changed_at?: string;
          id?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exclusive_capture_setting_history_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exclusive_capture_setting_history_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mt_1b_exclusive_capture_setting_history_actor_id_org_fk";
            columns: ["actor_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      exclusive_capture_settings: {
        Row: {
          enabled: boolean;
          id: boolean;
          organization_id: string;
        };
        Insert: {
          enabled?: boolean;
          id?: boolean;
          organization_id?: string;
        };
        Update: {
          enabled?: boolean;
          id?: boolean;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exclusive_capture_settings_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      exclusive_captures: {
        Row: {
          broker_cpf: string;
          broker_creci: string;
          broker_name: string;
          captor_id: string;
          created_at: string;
          created_by: string;
          created_on_sp: string;
          form_data: Json;
          id: string;
          organization_id: string;
          status: string;
          template: string;
          updated_at: string;
        };
        Insert: {
          broker_cpf?: string;
          broker_creci?: string;
          broker_name?: string;
          captor_id: string;
          created_at?: string;
          created_by: string;
          created_on_sp?: string;
          form_data?: Json;
          id?: string;
          organization_id?: string;
          status?: string;
          template: string;
          updated_at?: string;
        };
        Update: {
          broker_cpf?: string;
          broker_creci?: string;
          broker_name?: string;
          captor_id?: string;
          created_at?: string;
          created_by?: string;
          created_on_sp?: string;
          form_data?: Json;
          id?: string;
          organization_id?: string;
          status?: string;
          template?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exclusive_captures_captor_id_fkey";
            columns: ["captor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exclusive_captures_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exclusive_captures_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mt_1b_exclusive_captures_captor_id_org_fk";
            columns: ["captor_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_exclusive_captures_created_by_org_fk";
            columns: ["created_by", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      exclusive_documents: {
        Row: {
          capture_id: string;
          created_at: string;
          file_name: string;
          id: string;
          kind: string;
          organization_id: string;
          owner_index: number;
          storage_path: string;
          uploaded_by: string;
        };
        Insert: {
          capture_id: string;
          created_at?: string;
          file_name: string;
          id?: string;
          kind: string;
          organization_id?: string;
          owner_index?: number;
          storage_path: string;
          uploaded_by: string;
        };
        Update: {
          capture_id?: string;
          created_at?: string;
          file_name?: string;
          id?: string;
          kind?: string;
          organization_id?: string;
          owner_index?: number;
          storage_path?: string;
          uploaded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exclusive_documents_capture_id_fkey";
            columns: ["capture_id"];
            isOneToOne: false;
            referencedRelation: "exclusive_captures";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exclusive_documents_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exclusive_documents_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mt_1b_exclusive_documents_capture_id_org_fk";
            columns: ["capture_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "exclusive_captures";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_exclusive_documents_uploaded_by_org_fk";
            columns: ["uploaded_by", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      exclusive_history: {
        Row: {
          action: string;
          actor_id: string;
          capture_id: string;
          created_at: string;
          detail: string | null;
          id: number;
          organization_id: string;
        };
        Insert: {
          action: string;
          actor_id: string;
          capture_id: string;
          created_at?: string;
          detail?: string | null;
          id?: never;
          organization_id?: string;
        };
        Update: {
          action?: string;
          actor_id?: string;
          capture_id?: string;
          created_at?: string;
          detail?: string | null;
          id?: never;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exclusive_history_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exclusive_history_capture_id_fkey";
            columns: ["capture_id"];
            isOneToOne: false;
            referencedRelation: "exclusive_captures";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exclusive_history_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mt_1b_exclusive_history_actor_id_org_fk";
            columns: ["actor_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_exclusive_history_capture_id_org_fk";
            columns: ["capture_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "exclusive_captures";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      juridico_agent_audit: {
        Row: {
          action: string;
          agent_name: string;
          created_at: string;
          document_id: string | null;
          id: string;
          organization_id: string;
          request_id: string | null;
          result_count: number;
          sale_id: string | null;
        };
        Insert: {
          action: string;
          agent_name: string;
          created_at?: string;
          document_id?: string | null;
          id?: string;
          organization_id?: string;
          request_id?: string | null;
          result_count: number;
          sale_id?: string | null;
        };
        Update: {
          action?: string;
          agent_name?: string;
          created_at?: string;
          document_id?: string | null;
          id?: string;
          organization_id?: string;
          request_id?: string | null;
          result_count?: number;
          sale_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "juridico_agent_audit_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "sale_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "juridico_agent_audit_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "juridico_agent_audit_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mt_1b_juridico_agent_audit_document_id_org_fk";
            columns: ["document_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sale_documents";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_juridico_agent_audit_sale_id_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      metas: {
        Row: {
          corretor_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          mes: string;
          meta_comissao: number;
          organization_id: string;
          team_id: string | null;
          tipo: string;
          updated_at: string;
        };
        Insert: {
          corretor_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          mes: string;
          meta_comissao: number;
          organization_id?: string;
          team_id?: string | null;
          tipo: string;
          updated_at?: string;
        };
        Update: {
          corretor_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          mes?: string;
          meta_comissao?: number;
          organization_id?: string;
          team_id?: string | null;
          tipo?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "metas_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "metas_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mt_1b_metas_corretor_id_org_fk";
            columns: ["corretor_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_metas_created_by_org_fk";
            columns: ["created_by", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_metas_team_id_org_fk";
            columns: ["team_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      mt_1b_function_backup: {
        Row: {
          anon_exec: boolean;
          ddl: string;
          owner_name: string;
          signature: string;
        };
        Insert: {
          anon_exec?: boolean;
          ddl: string;
          owner_name: string;
          signature: string;
        };
        Update: {
          anon_exec?: boolean;
          ddl?: string;
          owner_name?: string;
          signature?: string;
        };
        Relationships: [];
      };
      mt_1c_function_backup: {
        Row: {
          ddl: string | null;
          signature: string | null;
        };
        Insert: {
          ddl?: string | null;
          signature?: string | null;
        };
        Update: {
          ddl?: string | null;
          signature?: string | null;
        };
        Relationships: [];
      };
      mt_1c_policy_backup: {
        Row: {
          cmd: string | null;
          permissive: string | null;
          policyname: unknown;
          qual: string | null;
          roles: unknown[] | null;
          with_check: string | null;
        };
        Insert: {
          cmd?: string | null;
          permissive?: string | null;
          policyname?: unknown;
          qual?: string | null;
          roles?: unknown[] | null;
          with_check?: string | null;
        };
        Update: {
          cmd?: string | null;
          permissive?: string | null;
          policyname?: unknown;
          qual?: string | null;
          roles?: unknown[] | null;
          with_check?: string | null;
        };
        Relationships: [];
      };
      mt_1d_function_backup: {
        Row: {
          ddl: string;
          signature: string;
        };
        Insert: {
          ddl: string;
          signature: string;
        };
        Update: {
          ddl?: string;
          signature?: string;
        };
        Relationships: [];
      };
      mt_1e_function_backup: {
        Row: {
          ddl: string;
          signature: string;
        };
        Insert: {
          ddl: string;
          signature: string;
        };
        Update: {
          ddl?: string;
          signature?: string;
        };
        Relationships: [];
      };
      mt_2a_function_backup: {
        Row: {
          ddl: string;
          signature: string;
        };
        Insert: {
          ddl: string;
          signature: string;
        };
        Update: {
          ddl?: string;
          signature?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          created_at: string;
          exclusive_capture_id: string | null;
          id: string;
          lida: boolean;
          mensagem: string | null;
          organization_id: string;
          sale_id: string | null;
          tipo: string;
          titulo: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          exclusive_capture_id?: string | null;
          id?: string;
          lida?: boolean;
          mensagem?: string | null;
          organization_id?: string;
          sale_id?: string | null;
          tipo: string;
          titulo: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          exclusive_capture_id?: string | null;
          id?: string;
          lida?: boolean;
          mensagem?: string | null;
          organization_id?: string;
          sale_id?: string | null;
          tipo?: string;
          titulo?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_notifications_sale_id_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_notifications_user_id_org_fk";
            columns: ["user_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "notifications_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      occurrence_commissions: {
        Row: {
          created_at: string;
          id: string;
          lado: string | null;
          managed_by_sale: boolean;
          nome: string | null;
          occurrence_id: string;
          organization_id: string;
          papel: string;
          percentual: number | null;
          sale_commission_extra_id: string | null;
          sem_cadastro_confirmado: boolean;
          creci_tipo: string | null;
          creci: string | null;
          user_id: string | null;
          valor: number | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          lado?: string | null;
          managed_by_sale?: boolean;
          nome?: string | null;
          occurrence_id: string;
          organization_id?: string;
          papel: string;
          percentual?: number | null;
          sale_commission_extra_id?: string | null;
          sem_cadastro_confirmado?: boolean;
          creci_tipo?: string | null;
          creci?: string | null;
          user_id?: string | null;
          valor?: number | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          lado?: string | null;
          managed_by_sale?: boolean;
          nome?: string | null;
          occurrence_id?: string;
          organization_id?: string;
          papel?: string;
          percentual?: number | null;
          sale_commission_extra_id?: string | null;
          sem_cadastro_confirmado?: boolean;
          creci_tipo?: string | null;
          creci?: string | null;
          user_id?: string | null;
          valor?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_occurrence_commissions_occurrence_id_org_fk";
            columns: ["occurrence_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "occurrences";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_occurrence_commissions_sale_commission_extra_id_org_fk";
            columns: ["sale_commission_extra_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sale_commission_extras";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_occurrence_commissions_user_id_org_fk";
            columns: ["user_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "occurrence_commissions_occurrence_id_fkey";
            columns: ["occurrence_id"];
            isOneToOne: false;
            referencedRelation: "occurrences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "occurrence_commissions_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "occurrence_commissions_sale_commission_extra_id_fkey";
            columns: ["sale_commission_extra_id"];
            isOneToOne: false;
            referencedRelation: "sale_commission_extras";
            referencedColumns: ["id"];
          },
        ];
      };
      occurrence_partners: {
        Row: {
          agencia: string | null;
          banco: string | null;
          conta: string | null;
          cpf_cnpj: string | null;
          creci_tipo: string | null;
          creci: string | null;
          created_at: string;
          from_sale: boolean;
          id: string;
          nome: string | null;
          occurrence_id: string;
          organization_id: string;
          percentual: number | null;
          pix: string | null;
          tipo: string | null;
          valor: number | null;
        };
        Insert: {
          agencia?: string | null;
          banco?: string | null;
          conta?: string | null;
          cpf_cnpj?: string | null;
          creci_tipo?: string | null;
          creci?: string | null;
          created_at?: string;
          from_sale?: boolean;
          id?: string;
          nome?: string | null;
          occurrence_id: string;
          organization_id?: string;
          percentual?: number | null;
          pix?: string | null;
          tipo?: string | null;
          valor?: number | null;
        };
        Update: {
          agencia?: string | null;
          banco?: string | null;
          conta?: string | null;
          cpf_cnpj?: string | null;
          creci_tipo?: string | null;
          creci?: string | null;
          created_at?: string;
          from_sale?: boolean;
          id?: string;
          nome?: string | null;
          occurrence_id?: string;
          organization_id?: string;
          percentual?: number | null;
          pix?: string | null;
          tipo?: string | null;
          valor?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_occurrence_partners_occurrence_id_org_fk";
            columns: ["occurrence_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "occurrences";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "occurrence_partners_occurrence_id_fkey";
            columns: ["occurrence_id"];
            isOneToOne: false;
            referencedRelation: "occurrences";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "occurrence_partners_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      occurrences: {
        Row: {
          aceita_financeiro: boolean;
          aceita_financeiro_em: string | null;
          aceita_financeiro_por: string | null;
          codigo_imovel: string | null;
          created_at: string;
          data_assinatura: string | null;
          financiamento: boolean | null;
          financiamento_banco: string | null;
          financiamento_correspondente: string | null;
          financiamento_previsao: string | null;
          financiamento_valor: number | null;
          id: string;
          midia: string | null;
          nota_fiscal_obrigatoria: boolean | null;
          oba_credito: boolean;
          observacoes: string | null;
          organization_id: string;
          percentual_comissao: number | null;
          premio_valor: number | null;
          prev_recebimento_data: string | null;
          prev_recebimento_forma: string | null;
          prev_recebimento_recebido_em: string | null;
          prev_recebimento_recebido_valor: number | null;
          prev_recebimento_valor: number | null;
          prev_recebimento2_data: string | null;
          prev_recebimento2_forma: string | null;
          prev_recebimento2_recebido_em: string | null;
          prev_recebimento2_recebido_valor: number | null;
          prev_recebimento2_valor: number | null;
          prev_recebimento3_data: string | null;
          prev_recebimento3_forma: string | null;
          prev_recebimento3_recebido_em: string | null;
          prev_recebimento3_recebido_valor: number | null;
          prev_recebimento3_valor: number | null;
          reopen_reason: string | null;
          reopened_at: string | null;
          reopened_by: string | null;
          sale_id: string;
          status: string;
          tempo_venda: string | null;
          tempo_venda_dias: number | null;
          updated_at: string;
          valor_anunciado: number | null;
          valor_comissao: number | null;
          valor_negociado: number | null;
        };
        Insert: {
          aceita_financeiro?: boolean;
          aceita_financeiro_em?: string | null;
          aceita_financeiro_por?: string | null;
          codigo_imovel?: string | null;
          created_at?: string;
          data_assinatura?: string | null;
          financiamento?: boolean | null;
          financiamento_banco?: string | null;
          financiamento_correspondente?: string | null;
          financiamento_previsao?: string | null;
          financiamento_valor?: number | null;
          id?: string;
          midia?: string | null;
          nota_fiscal_obrigatoria?: boolean | null;
          oba_credito?: boolean;
          observacoes?: string | null;
          organization_id?: string;
          percentual_comissao?: number | null;
          premio_valor?: number | null;
          prev_recebimento_data?: string | null;
          prev_recebimento_forma?: string | null;
          prev_recebimento_recebido_em?: string | null;
          prev_recebimento_recebido_valor?: number | null;
          prev_recebimento_valor?: number | null;
          prev_recebimento2_data?: string | null;
          prev_recebimento2_forma?: string | null;
          prev_recebimento2_recebido_em?: string | null;
          prev_recebimento2_recebido_valor?: number | null;
          prev_recebimento2_valor?: number | null;
          prev_recebimento3_data?: string | null;
          prev_recebimento3_forma?: string | null;
          prev_recebimento3_recebido_em?: string | null;
          prev_recebimento3_recebido_valor?: number | null;
          prev_recebimento3_valor?: number | null;
          reopen_reason?: string | null;
          reopened_at?: string | null;
          reopened_by?: string | null;
          sale_id: string;
          status?: string;
          tempo_venda?: string | null;
          tempo_venda_dias?: number | null;
          updated_at?: string;
          valor_anunciado?: number | null;
          valor_comissao?: number | null;
          valor_negociado?: number | null;
        };
        Update: {
          aceita_financeiro?: boolean;
          aceita_financeiro_em?: string | null;
          aceita_financeiro_por?: string | null;
          codigo_imovel?: string | null;
          created_at?: string;
          data_assinatura?: string | null;
          financiamento?: boolean | null;
          financiamento_banco?: string | null;
          financiamento_correspondente?: string | null;
          financiamento_previsao?: string | null;
          financiamento_valor?: number | null;
          id?: string;
          midia?: string | null;
          nota_fiscal_obrigatoria?: boolean | null;
          oba_credito?: boolean;
          observacoes?: string | null;
          organization_id?: string;
          percentual_comissao?: number | null;
          premio_valor?: number | null;
          prev_recebimento_data?: string | null;
          prev_recebimento_forma?: string | null;
          prev_recebimento_recebido_em?: string | null;
          prev_recebimento_recebido_valor?: number | null;
          prev_recebimento_valor?: number | null;
          prev_recebimento2_data?: string | null;
          prev_recebimento2_forma?: string | null;
          prev_recebimento2_recebido_em?: string | null;
          prev_recebimento2_recebido_valor?: number | null;
          prev_recebimento2_valor?: number | null;
          prev_recebimento3_data?: string | null;
          prev_recebimento3_forma?: string | null;
          prev_recebimento3_recebido_em?: string | null;
          prev_recebimento3_recebido_valor?: number | null;
          prev_recebimento3_valor?: number | null;
          reopen_reason?: string | null;
          reopened_at?: string | null;
          reopened_by?: string | null;
          sale_id?: string;
          status?: string;
          tempo_venda?: string | null;
          tempo_venda_dias?: number | null;
          updated_at?: string;
          valor_anunciado?: number | null;
          valor_comissao?: number | null;
          valor_negociado?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "occurrences_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: true;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "occurrences_sale_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      operational_impersonation_actions: {
        Row: {
          actor_user_id: string;
          created_at: string;
          id: number;
          impersonation_session_id: string;
          operation: string;
          organization_id: string;
          record_id: string | null;
          table_name: string;
          target_user_id: string;
        };
        Insert: {
          actor_user_id: string;
          created_at?: string;
          id?: never;
          impersonation_session_id: string;
          operation: string;
          organization_id?: string;
          record_id?: string | null;
          table_name: string;
          target_user_id: string;
        };
        Update: {
          actor_user_id?: string;
          created_at?: string;
          id?: never;
          impersonation_session_id?: string;
          operation?: string;
          organization_id?: string;
          record_id?: string | null;
          table_name?: string;
          target_user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_operational_impersonation_actions_actor_user_id_org_fk";
            columns: ["actor_user_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_operational_impersonation_actions_impersonation_session_i";
            columns: ["impersonation_session_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "operational_impersonation_sessions";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_operational_impersonation_actions_target_user_id_org_fk";
            columns: ["target_user_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "operational_impersonation_actions_impersonation_session_id_fkey";
            columns: ["impersonation_session_id"];
            isOneToOne: false;
            referencedRelation: "operational_impersonation_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "operational_impersonation_actions_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      operational_impersonation_sessions: {
        Row: {
          actor_user_id: string;
          auth_session_id: string | null;
          ended_at: string | null;
          id: string;
          organization_id: string;
          requested_at: string;
          started_at: string | null;
          status: string;
          target_user_id: string;
        };
        Insert: {
          actor_user_id: string;
          auth_session_id?: string | null;
          ended_at?: string | null;
          id?: string;
          organization_id?: string;
          requested_at?: string;
          started_at?: string | null;
          status?: string;
          target_user_id: string;
        };
        Update: {
          actor_user_id?: string;
          auth_session_id?: string | null;
          ended_at?: string | null;
          id?: string;
          organization_id?: string;
          requested_at?: string;
          started_at?: string | null;
          status?: string;
          target_user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_operational_impersonation_sessions_actor_user_id_org_fk";
            columns: ["actor_user_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_operational_impersonation_sessions_target_user_id_org_fk";
            columns: ["target_user_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "operational_impersonation_sessions_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_members: {
        Row: {
          ativo: boolean;
          created_at: string;
          organization_id: string;
          user_id: string;
        };
        Insert: {
          ativo?: boolean;
          created_at?: string;
          organization_id?: string;
          user_id: string;
        };
        Update: {
          ativo?: boolean;
          created_at?: string;
          organization_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          cnpj: string | null;
          cor_primaria: string | null;
          cor_secundaria: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          legacy_default: boolean;
          logo_path: string | null;
          nome: string;
          slug: string;
          status: string;
        };
        Insert: {
          cnpj?: string | null;
          cor_primaria?: string | null;
          cor_secundaria?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          legacy_default?: boolean;
          logo_path?: string | null;
          nome: string;
          slug: string;
          status?: string;
        };
        Update: {
          cnpj?: string | null;
          cor_primaria?: string | null;
          cor_secundaria?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          legacy_default?: boolean;
          logo_path?: string | null;
          nome?: string;
          slug?: string;
          status?: string;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      positioning_region_suggestions: {
        Row: {
          cidade: string;
          created_at: string;
          id: string;
          nome: string;
          organization_id: string;
          region_id: number | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          suggested_by: string;
          tipo: string;
          zona: string | null;
        };
        Insert: {
          cidade: string;
          created_at?: string;
          id?: string;
          nome: string;
          organization_id?: string;
          region_id?: number | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          suggested_by: string;
          tipo: string;
          zona?: string | null;
        };
        Update: {
          cidade?: string;
          created_at?: string;
          id?: string;
          nome?: string;
          organization_id?: string;
          region_id?: number | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          suggested_by?: string;
          tipo?: string;
          zona?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "positioning_region_suggestions_organization_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "positioning_region_suggestions_region_id_fkey";
            columns: ["region_id"];
            isOneToOne: false;
            referencedRelation: "positioning_regions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "positioning_region_suggestions_region_org_fk";
            columns: ["region_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "positioning_regions";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "positioning_region_suggestions_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "positioning_region_suggestions_suggested_by_fkey";
            columns: ["suggested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "positioning_region_suggestions_suggested_by_org_fk";
            columns: ["suggested_by", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      positioning_regions: {
        Row: {
          ativo: boolean;
          cidade: string;
          created_at: string;
          id: number;
          nome: string;
          organization_id: string;
          tipo: string;
          zona: string | null;
        };
        Insert: {
          ativo?: boolean;
          cidade: string;
          created_at?: string;
          id?: number;
          nome: string;
          organization_id?: string;
          tipo?: string;
          zona?: string | null;
        };
        Update: {
          ativo?: boolean;
          cidade?: string;
          created_at?: string;
          id?: number;
          nome?: string;
          organization_id?: string;
          tipo?: string;
          zona?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "positioning_regions_organization_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          ativo: boolean;
          avatar_url: string | null;
          cpf: string | null;
          created_at: string;
          creci: string | null;
          email: string | null;
          id: string;
          instagram_url: string | null;
          nome: string;
          organization_id: string;
          pagina_pessoal_url: string | null;
          public_profile_enabled: boolean;
          remax_id: string | null;
          telefone: string | null;
          updated_at: string;
        };
        Insert: {
          ativo?: boolean;
          avatar_url?: string | null;
          cpf?: string | null;
          created_at?: string;
          creci?: string | null;
          email?: string | null;
          id: string;
          instagram_url?: string | null;
          nome?: string;
          organization_id?: string;
          pagina_pessoal_url?: string | null;
          public_profile_enabled?: boolean;
          remax_id?: string | null;
          telefone?: string | null;
          updated_at?: string;
        };
        Update: {
          ativo?: boolean;
          avatar_url?: string | null;
          cpf?: string | null;
          created_at?: string;
          creci?: string | null;
          email?: string | null;
          id?: string;
          instagram_url?: string | null;
          nome?: string;
          organization_id?: string;
          pagina_pessoal_url?: string | null;
          public_profile_enabled?: boolean;
          remax_id?: string | null;
          telefone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_organization_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      room_reservation_cancellation_penalties: {
        Row: {
          blocked_until: string | null;
          late_cancellation_count: number;
          organization_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          blocked_until?: string | null;
          late_cancellation_count?: number;
          organization_id?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          blocked_until?: string | null;
          late_cancellation_count?: number;
          organization_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_room_reservation_cancellation_penalties_user_id_org_fk";
            columns: ["user_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "room_reservation_cancellation_penalties_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      room_reservation_reminder_deliveries: {
        Row: {
          last_error: string | null;
          organization_id: string;
          phone: string;
          recipient_id: string;
          reservation_id: string;
          sent_at: string | null;
          updated_at: string;
        };
        Insert: {
          last_error?: string | null;
          organization_id?: string;
          phone: string;
          recipient_id: string;
          reservation_id: string;
          sent_at?: string | null;
          updated_at?: string;
        };
        Update: {
          last_error?: string | null;
          organization_id?: string;
          phone?: string;
          recipient_id?: string;
          reservation_id?: string;
          sent_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_room_reservation_reminder_deliveries_recipient_id_org_fk";
            columns: ["recipient_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_room_reservation_reminder_deliveries_reservation_id_org_f";
            columns: ["reservation_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "room_reservations";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "room_reservation_reminder_deliveries_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "room_reservation_reminder_deliveries_reservation_id_fkey";
            columns: ["reservation_id"];
            isOneToOne: false;
            referencedRelation: "room_reservations";
            referencedColumns: ["id"];
          },
        ];
      };
      room_reservations: {
        Row: {
          canceled_at: string | null;
          canceled_by: string | null;
          cancellation_deadline_minutes: number;
          created_at: string;
          end_time: string;
          id: string;
          late_cancellation: boolean;
          notes: string;
          organization_id: string;
          participant_user_ids: string[];
          participants: string[];
          purpose: string;
          reminder_minutes_before: number;
          reminder_sent_at: string | null;
          reservation_group_id: string;
          reserved_date: string;
          responsible_id: string;
          responsible_name: string;
          room: string;
          start_time: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          canceled_at?: string | null;
          canceled_by?: string | null;
          cancellation_deadline_minutes?: number;
          created_at?: string;
          end_time: string;
          id?: string;
          late_cancellation?: boolean;
          notes?: string;
          organization_id?: string;
          participant_user_ids?: string[];
          participants?: string[];
          purpose: string;
          reminder_minutes_before?: number;
          reminder_sent_at?: string | null;
          reservation_group_id?: string;
          reserved_date: string;
          responsible_id: string;
          responsible_name: string;
          room: string;
          start_time: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          canceled_at?: string | null;
          canceled_by?: string | null;
          cancellation_deadline_minutes?: number;
          created_at?: string;
          end_time?: string;
          id?: string;
          late_cancellation?: boolean;
          notes?: string;
          organization_id?: string;
          participant_user_ids?: string[];
          participants?: string[];
          purpose?: string;
          reminder_minutes_before?: number;
          reminder_sent_at?: string | null;
          reservation_group_id?: string;
          reserved_date?: string;
          responsible_id?: string;
          responsible_name?: string;
          room?: string;
          start_time?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "room_reservations_organization_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "room_reservations_responsible_org_fk";
            columns: ["responsible_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      sale_bank_accounts: {
        Row: {
          agencia: string | null;
          banco: string | null;
          conta: string | null;
          created_at: string;
          id: string;
          organization_id: string;
          parte: string;
          pix: string | null;
          sale_id: string;
          titular: string | null;
        };
        Insert: {
          agencia?: string | null;
          banco?: string | null;
          conta?: string | null;
          created_at?: string;
          id?: string;
          organization_id?: string;
          parte: string;
          pix?: string | null;
          sale_id: string;
          titular?: string | null;
        };
        Update: {
          agencia?: string | null;
          banco?: string | null;
          conta?: string | null;
          created_at?: string;
          id?: string;
          organization_id?: string;
          parte?: string;
          pix?: string | null;
          sale_id?: string;
          titular?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_sale_bank_accounts_sale_id_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sale_bank_accounts_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_bank_accounts_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_comment_recipients: {
        Row: {
          comment_id: string;
          created_at: string;
          id: string;
          organization_id: string;
          read_at: string | null;
          sale_id: string;
          user_id: string;
        };
        Insert: {
          comment_id: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
          read_at?: string | null;
          sale_id: string;
          user_id: string;
        };
        Update: {
          comment_id?: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
          read_at?: string | null;
          sale_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_sale_comment_recipients_comment_id_org_fk";
            columns: ["comment_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sale_comments";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_sale_comment_recipients_sale_id_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_sale_comment_recipients_user_id_org_fk";
            columns: ["user_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sale_comment_recipients_comment_id_fkey";
            columns: ["comment_id"];
            isOneToOne: false;
            referencedRelation: "sale_comments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_comment_recipients_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_comment_recipients_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_comments: {
        Row: {
          autor_id: string;
          created_at: string;
          doc_id: string | null;
          escopo: string;
          id: string;
          organization_id: string;
          sale_id: string;
          texto: string;
        };
        Insert: {
          autor_id: string;
          created_at?: string;
          doc_id?: string | null;
          escopo?: string;
          id?: string;
          organization_id?: string;
          sale_id: string;
          texto: string;
        };
        Update: {
          autor_id?: string;
          created_at?: string;
          doc_id?: string | null;
          escopo?: string;
          id?: string;
          organization_id?: string;
          sale_id?: string;
          texto?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_sale_comments_autor_id_org_fk";
            columns: ["autor_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_sale_comments_doc_id_org_fk";
            columns: ["doc_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sale_documents";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_sale_comments_sale_id_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sale_comments_doc_id_fkey";
            columns: ["doc_id"];
            isOneToOne: false;
            referencedRelation: "sale_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_comments_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_comments_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_commission_extras: {
        Row: {
          created_at: string;
          id: string;
          lado: string | null;
          nome: string | null;
          organization_id: string;
          origem: string;
          papel: string | null;
          percentual: number | null;
          sale_id: string;
          sem_cadastro_confirmado: boolean;
          creci_tipo: string | null;
          creci: string | null;
          user_id: string | null;
          valor: number | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          lado?: string | null;
          nome?: string | null;
          organization_id?: string;
          origem?: string;
          papel?: string | null;
          percentual?: number | null;
          sale_id: string;
          sem_cadastro_confirmado?: boolean;
          creci_tipo?: string | null;
          creci?: string | null;
          user_id?: string | null;
          valor?: number | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          lado?: string | null;
          nome?: string | null;
          organization_id?: string;
          origem?: string;
          papel?: string | null;
          percentual?: number | null;
          sale_id?: string;
          sem_cadastro_confirmado?: boolean;
          creci_tipo?: string | null;
          creci?: string | null;
          user_id?: string | null;
          valor?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_sale_commission_extras_sale_id_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_sale_commission_extras_user_id_org_fk";
            columns: ["user_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sale_commission_extras_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_commission_extras_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_commission_extras_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_documents: {
        Row: {
          created_at: string;
          deleted_at: string | null;
          deleted_by: string | null;
          descricao: string | null;
          extraction_status: string;
          file_name: string | null;
          id: string;
          motivo_recusa: string | null;
          organization_id: string;
          parte: string;
          sale_id: string;
          status: Database["public"]["Enums"]["doc_status"];
          storage_path: string | null;
          tipo: string;
          updated_at: string;
          uploaded_by: string | null;
          versao: number;
        };
        Insert: {
          created_at?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          descricao?: string | null;
          extraction_status?: string;
          file_name?: string | null;
          id?: string;
          motivo_recusa?: string | null;
          organization_id?: string;
          parte?: string;
          sale_id: string;
          status?: Database["public"]["Enums"]["doc_status"];
          storage_path?: string | null;
          tipo: string;
          updated_at?: string;
          uploaded_by?: string | null;
          versao?: number;
        };
        Update: {
          created_at?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          descricao?: string | null;
          extraction_status?: string;
          file_name?: string | null;
          id?: string;
          motivo_recusa?: string | null;
          organization_id?: string;
          parte?: string;
          sale_id?: string;
          status?: Database["public"]["Enums"]["doc_status"];
          storage_path?: string | null;
          tipo?: string;
          updated_at?: string;
          uploaded_by?: string | null;
          versao?: number;
        };
        Relationships: [
          {
            foreignKeyName: "sale_documents_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_documents_sale_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      sale_juridico_reached: {
        Row: {
          organization_id: string;
          reached_at: string;
          sale_id: string;
        };
        Insert: {
          organization_id?: string;
          reached_at?: string;
          sale_id: string;
        };
        Update: {
          organization_id?: string;
          reached_at?: string;
          sale_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_sale_juridico_reached_sale_id_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sale_juridico_reached_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_juridico_reached_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: true;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_parties: {
        Row: {
          cliente_id: string | null;
          cnpj: string | null;
          cpf_cnpj: string | null;
          created_at: string;
          email: string | null;
          endereco: string | null;
          id: string;
          nome: string | null;
          organization_id: string;
          papel: string;
          profissao: string | null;
          razao_social: string | null;
          regime_casamento: string | null;
          nacionalidade: string | null;
          estado_civil: string | null;
          conjuge_nome: string | null;
          conjuge_nacionalidade: string | null;
          conjuge_profissao: string | null;
          conjuge_rg: string | null;
          conjuge_cpf: string | null;
          conjuge_endereco: string | null;
          rg: string | null;
          sale_id: string;
          telefone: string | null;
          tipo_pessoa: string;
        };
        Insert: {
          cliente_id?: string | null;
          cnpj?: string | null;
          cpf_cnpj?: string | null;
          created_at?: string;
          email?: string | null;
          endereco?: string | null;
          id?: string;
          nome?: string | null;
          organization_id?: string;
          papel: string;
          profissao?: string | null;
          razao_social?: string | null;
          regime_casamento?: string | null;
          nacionalidade?: string | null;
          estado_civil?: string | null;
          conjuge_nome?: string | null;
          conjuge_nacionalidade?: string | null;
          conjuge_profissao?: string | null;
          conjuge_rg?: string | null;
          conjuge_cpf?: string | null;
          conjuge_endereco?: string | null;
          rg?: string | null;
          sale_id: string;
          telefone?: string | null;
          tipo_pessoa?: string;
        };
        Update: {
          cliente_id?: string | null;
          cnpj?: string | null;
          cpf_cnpj?: string | null;
          created_at?: string;
          email?: string | null;
          endereco?: string | null;
          id?: string;
          nome?: string | null;
          organization_id?: string;
          papel?: string;
          profissao?: string | null;
          razao_social?: string | null;
          regime_casamento?: string | null;
          nacionalidade?: string | null;
          estado_civil?: string | null;
          conjuge_nome?: string | null;
          conjuge_nacionalidade?: string | null;
          conjuge_profissao?: string | null;
          conjuge_rg?: string | null;
          conjuge_cpf?: string | null;
          conjuge_endereco?: string | null;
          rg?: string | null;
          sale_id?: string;
          telefone?: string | null;
          tipo_pessoa?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_sale_parties_cliente_id_org_fk";
            columns: ["cliente_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "clientes";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_sale_parties_sale_id_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sale_parties_cliente_id_fkey";
            columns: ["cliente_id"];
            isOneToOne: false;
            referencedRelation: "clientes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_parties_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_parties_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_payment: {
        Row: {
          consorcio_cota: string | null;
          consorcio_grupo: string | null;
          consorcio_nome: string | null;
          consorcio_valor: number | null;
          entrada_data: string | null;
          entrada_valor: number | null;
          fgts: boolean | null;
          fgts_observacao: string | null;
          fgts_valor: number | null;
          financiamento: boolean | null;
          financiamento_banco: string | null;
          financiamento_correspondente: string | null;
          financiamento_observacao: string | null;
          financiamento_previsao: string | null;
          financiamento_valor: number | null;
          oba_credito: boolean;
          observacoes: string | null;
          organization_id: string;
          pagamento_final_data: string | null;
          pagamento_final_valor: number | null;
          parcela1_data: string | null;
          parcela1_valor: number | null;
          parcela2_data: string | null;
          parcela2_valor: number | null;
          sale_id: string;
          tipo_pagamento: string;
        };
        Insert: {
          consorcio_cota?: string | null;
          consorcio_grupo?: string | null;
          consorcio_nome?: string | null;
          consorcio_valor?: number | null;
          entrada_data?: string | null;
          entrada_valor?: number | null;
          fgts?: boolean | null;
          fgts_observacao?: string | null;
          fgts_valor?: number | null;
          financiamento?: boolean | null;
          financiamento_banco?: string | null;
          financiamento_correspondente?: string | null;
          financiamento_observacao?: string | null;
          financiamento_previsao?: string | null;
          financiamento_valor?: number | null;
          oba_credito?: boolean;
          observacoes?: string | null;
          organization_id?: string;
          pagamento_final_data?: string | null;
          pagamento_final_valor?: number | null;
          parcela1_data?: string | null;
          parcela1_valor?: number | null;
          parcela2_data?: string | null;
          parcela2_valor?: number | null;
          sale_id: string;
          tipo_pagamento?: string;
        };
        Update: {
          consorcio_cota?: string | null;
          consorcio_grupo?: string | null;
          consorcio_nome?: string | null;
          consorcio_valor?: number | null;
          entrada_data?: string | null;
          entrada_valor?: number | null;
          fgts?: boolean | null;
          fgts_observacao?: string | null;
          fgts_valor?: number | null;
          financiamento?: boolean | null;
          financiamento_banco?: string | null;
          financiamento_correspondente?: string | null;
          financiamento_observacao?: string | null;
          financiamento_previsao?: string | null;
          financiamento_valor?: number | null;
          oba_credito?: boolean;
          observacoes?: string | null;
          organization_id?: string;
          pagamento_final_data?: string | null;
          pagamento_final_valor?: number | null;
          parcela1_data?: string | null;
          parcela1_valor?: number | null;
          parcela2_data?: string | null;
          parcela2_valor?: number | null;
          sale_id?: string;
          tipo_pagamento?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sale_payment_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: true;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_payment_sale_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      sale_status_history: {
        Row: {
          autor_id: string | null;
          created_at: string;
          de: Database["public"]["Enums"]["sale_status"] | null;
          id: string;
          motivo: string | null;
          organization_id: string;
          para: Database["public"]["Enums"]["sale_status"];
          sale_id: string;
        };
        Insert: {
          autor_id?: string | null;
          created_at?: string;
          de?: Database["public"]["Enums"]["sale_status"] | null;
          id?: string;
          motivo?: string | null;
          organization_id?: string;
          para: Database["public"]["Enums"]["sale_status"];
          sale_id: string;
        };
        Update: {
          autor_id?: string | null;
          created_at?: string;
          de?: Database["public"]["Enums"]["sale_status"] | null;
          id?: string;
          motivo?: string | null;
          organization_id?: string;
          para?: Database["public"]["Enums"]["sale_status"];
          sale_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_sale_status_history_autor_id_org_fk";
            columns: ["autor_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_sale_status_history_sale_id_org_fk";
            columns: ["sale_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sale_status_history_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_status_history_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
        ];
      };
      sales: {
        Row: {
          codigo_interno: string | null;
          comissao_observacoes: string | null;
          comissao_quando: string | null;
          comissao_valor: number | null;
          contrato_libera_assinatura: boolean;
          contrato_pendencia_descricao: string | null;
          coordenador_id: string | null;
          corretor_captador: string | null;
          corretor_captador_id: string | null;
          corretor_id: string;
          corretor_vendedor: string | null;
          corretor_vendedor_id: string | null;
          created_at: string;
          data_assinatura: string | null;
          forma_pagamento: string | null;
          id: string;
          imovel_endereco: string | null;
          imovel_cep: string | null;
          imovel_logradouro: string | null;
          imovel_numero: string | null;
          imovel_complemento: string | null;
          imovel_bairro: string | null;
          imovel_cidade: string | null;
          imovel_uf: string | null;
          imovel_id: string | null;
          imovel_observacoes: string | null;
          indicador: string | null;
          indicador_captador: string | null;
          indicador_captador_id: string | null;
          indicador_lado: string | null;
          indicador_vendedor: string | null;
          indicador_vendedor_id: string | null;
          iptu: string | null;
          lancamento_saldo_confirmado_em: string | null;
          lancamento_saldo_confirmado_por: string | null;
          lancamento_saldo_imobiliaria: number | null;
          lider_captador_id: string | null;
          lider_captador_nome: string | null;
          lider_vendedor_id: string | null;
          lider_vendedor_nome: string | null;
          matricula: string | null;
          midia: string | null;
          modalidade: string;
          negociacao_observacoes: string | null;
          nota_fiscal_obrigatoria: boolean;
          observacoes_gerais: string | null;
          imovel_observacoes_origem: string;
          imovel_descricao_corrigida_por: string | null;
          imovel_descricao_corrigida_em: string | null;
          contas_vendedores_individuais: boolean | null;
          organization_id: string;
          parceria_agencia: string | null;
          parceria_banco: string | null;
          parceria_conta: string | null;
          parceria_cpf_cnpj: string | null;
          parceria_externa_captacao: boolean;
          parceria_externa_venda: boolean;
          parceria_nome: string | null;
          parceria_percentual: number | null;
          parceria_pix: string | null;
          parceria_creci_tipo: string | null;
          parceria_observacoes: string | null;
          parceria_creci: string | null;
          parceria_tipo: string | null;
          parceria_valor: number | null;
          percentual_comissao: number | null;
          percentual_comissao_captador: number | null;
          percentual_comissao_indicador: number | null;
          percentual_comissao_vendedor: number | null;
          percentual_remax: number | null;
          posse_data: string | null;
          posse_observacoes: string | null;
          premio_valor: number | null;
          previsao_recebimento_data: string | null;
          previsao_recebimento_forma: string | null;
          previsao_recebimento_valor: number | null;
          previsao_recebimento2_data: string | null;
          previsao_recebimento2_forma: string | null;
          previsao_recebimento2_valor: number | null;
          previsao_recebimento3_data: string | null;
          previsao_recebimento3_forma: string | null;
          previsao_recebimento3_valor: number | null;
          status: Database["public"]["Enums"]["sale_status"];
          team_leader_id: string | null;
          tempo_venda: string | null;
          tempo_venda_dias: number | null;
          updated_at: string;
          valor_anunciado: number | null;
          valor_comissao_captador: number | null;
          valor_comissao_imobiliaria: number | null;
          valor_comissao_indicador: number | null;
          valor_comissao_indicador_captador: number | null;
          valor_comissao_indicador_vendedor: number | null;
          valor_comissao_lider_captador: number | null;
          valor_comissao_lider_vendedor: number | null;
          valor_comissao_vendedor: number | null;
          valor_negociado: number | null;
          valor_remax: number | null;
          valor_total_comissao: number | null;
        };
        Insert: {
          codigo_interno?: string | null;
          comissao_observacoes?: string | null;
          comissao_quando?: string | null;
          comissao_valor?: number | null;
          contrato_libera_assinatura?: boolean;
          contrato_pendencia_descricao?: string | null;
          coordenador_id?: string | null;
          corretor_captador?: string | null;
          corretor_captador_id?: string | null;
          corretor_id: string;
          corretor_vendedor?: string | null;
          corretor_vendedor_id?: string | null;
          created_at?: string;
          data_assinatura?: string | null;
          forma_pagamento?: string | null;
          id?: string;
          imovel_endereco?: string | null;
          imovel_cep?: string | null;
          imovel_logradouro?: string | null;
          imovel_numero?: string | null;
          imovel_complemento?: string | null;
          imovel_bairro?: string | null;
          imovel_cidade?: string | null;
          imovel_uf?: string | null;
          imovel_id?: string | null;
          imovel_observacoes?: string | null;
          indicador?: string | null;
          indicador_captador?: string | null;
          indicador_captador_id?: string | null;
          indicador_lado?: string | null;
          indicador_vendedor?: string | null;
          indicador_vendedor_id?: string | null;
          iptu?: string | null;
          lancamento_saldo_confirmado_em?: string | null;
          lancamento_saldo_confirmado_por?: string | null;
          lancamento_saldo_imobiliaria?: number | null;
          lider_captador_id?: string | null;
          lider_captador_nome?: string | null;
          lider_vendedor_id?: string | null;
          lider_vendedor_nome?: string | null;
          matricula?: string | null;
          midia?: string | null;
          modalidade?: string;
          negociacao_observacoes?: string | null;
          nota_fiscal_obrigatoria?: boolean;
          observacoes_gerais?: string | null;
          imovel_observacoes_origem?: string;
          imovel_descricao_corrigida_por?: string | null;
          imovel_descricao_corrigida_em?: string | null;
          contas_vendedores_individuais?: boolean | null;
          organization_id?: string;
          parceria_agencia?: string | null;
          parceria_banco?: string | null;
          parceria_conta?: string | null;
          parceria_cpf_cnpj?: string | null;
          parceria_externa_captacao?: boolean;
          parceria_externa_venda?: boolean;
          parceria_nome?: string | null;
          parceria_percentual?: number | null;
          parceria_pix?: string | null;
          parceria_creci_tipo?: string | null;
          parceria_observacoes?: string | null;
          parceria_creci?: string | null;
          parceria_tipo?: string | null;
          parceria_valor?: number | null;
          percentual_comissao?: number | null;
          percentual_comissao_captador?: number | null;
          percentual_comissao_indicador?: number | null;
          percentual_comissao_vendedor?: number | null;
          percentual_remax?: number | null;
          posse_data?: string | null;
          posse_observacoes?: string | null;
          premio_valor?: number | null;
          previsao_recebimento_data?: string | null;
          previsao_recebimento_forma?: string | null;
          previsao_recebimento_valor?: number | null;
          previsao_recebimento2_data?: string | null;
          previsao_recebimento2_forma?: string | null;
          previsao_recebimento2_valor?: number | null;
          previsao_recebimento3_data?: string | null;
          previsao_recebimento3_forma?: string | null;
          previsao_recebimento3_valor?: number | null;
          status?: Database["public"]["Enums"]["sale_status"];
          team_leader_id?: string | null;
          tempo_venda?: string | null;
          tempo_venda_dias?: number | null;
          updated_at?: string;
          valor_anunciado?: number | null;
          valor_comissao_captador?: number | null;
          valor_comissao_imobiliaria?: number | null;
          valor_comissao_indicador?: number | null;
          valor_comissao_indicador_captador?: number | null;
          valor_comissao_indicador_vendedor?: number | null;
          valor_comissao_lider_captador?: number | null;
          valor_comissao_lider_vendedor?: number | null;
          valor_comissao_vendedor?: number | null;
          valor_negociado?: number | null;
          valor_remax?: number | null;
          valor_total_comissao?: number | null;
        };
        Update: {
          codigo_interno?: string | null;
          comissao_observacoes?: string | null;
          comissao_quando?: string | null;
          comissao_valor?: number | null;
          contrato_libera_assinatura?: boolean;
          contrato_pendencia_descricao?: string | null;
          coordenador_id?: string | null;
          corretor_captador?: string | null;
          corretor_captador_id?: string | null;
          corretor_id?: string;
          corretor_vendedor?: string | null;
          corretor_vendedor_id?: string | null;
          created_at?: string;
          data_assinatura?: string | null;
          forma_pagamento?: string | null;
          id?: string;
          imovel_endereco?: string | null;
          imovel_cep?: string | null;
          imovel_logradouro?: string | null;
          imovel_numero?: string | null;
          imovel_complemento?: string | null;
          imovel_bairro?: string | null;
          imovel_cidade?: string | null;
          imovel_uf?: string | null;
          imovel_id?: string | null;
          imovel_observacoes?: string | null;
          indicador?: string | null;
          indicador_captador?: string | null;
          indicador_captador_id?: string | null;
          indicador_lado?: string | null;
          indicador_vendedor?: string | null;
          indicador_vendedor_id?: string | null;
          iptu?: string | null;
          lancamento_saldo_confirmado_em?: string | null;
          lancamento_saldo_confirmado_por?: string | null;
          lancamento_saldo_imobiliaria?: number | null;
          lider_captador_id?: string | null;
          lider_captador_nome?: string | null;
          lider_vendedor_id?: string | null;
          lider_vendedor_nome?: string | null;
          matricula?: string | null;
          midia?: string | null;
          modalidade?: string;
          negociacao_observacoes?: string | null;
          nota_fiscal_obrigatoria?: boolean;
          observacoes_gerais?: string | null;
          imovel_observacoes_origem?: string;
          imovel_descricao_corrigida_por?: string | null;
          imovel_descricao_corrigida_em?: string | null;
          contas_vendedores_individuais?: boolean | null;
          organization_id?: string;
          parceria_agencia?: string | null;
          parceria_banco?: string | null;
          parceria_conta?: string | null;
          parceria_cpf_cnpj?: string | null;
          parceria_externa_captacao?: boolean;
          parceria_externa_venda?: boolean;
          parceria_nome?: string | null;
          parceria_percentual?: number | null;
          parceria_pix?: string | null;
          parceria_creci_tipo?: string | null;
          parceria_observacoes?: string | null;
          parceria_creci?: string | null;
          parceria_tipo?: string | null;
          parceria_valor?: number | null;
          percentual_comissao?: number | null;
          percentual_comissao_captador?: number | null;
          percentual_comissao_indicador?: number | null;
          percentual_comissao_vendedor?: number | null;
          percentual_remax?: number | null;
          posse_data?: string | null;
          posse_observacoes?: string | null;
          premio_valor?: number | null;
          previsao_recebimento_data?: string | null;
          previsao_recebimento_forma?: string | null;
          previsao_recebimento_valor?: number | null;
          previsao_recebimento2_data?: string | null;
          previsao_recebimento2_forma?: string | null;
          previsao_recebimento2_valor?: number | null;
          previsao_recebimento3_data?: string | null;
          previsao_recebimento3_forma?: string | null;
          previsao_recebimento3_valor?: number | null;
          status?: Database["public"]["Enums"]["sale_status"];
          team_leader_id?: string | null;
          tempo_venda?: string | null;
          tempo_venda_dias?: number | null;
          updated_at?: string;
          valor_anunciado?: number | null;
          valor_comissao_captador?: number | null;
          valor_comissao_imobiliaria?: number | null;
          valor_comissao_indicador?: number | null;
          valor_comissao_indicador_captador?: number | null;
          valor_comissao_indicador_vendedor?: number | null;
          valor_comissao_lider_captador?: number | null;
          valor_comissao_lider_vendedor?: number | null;
          valor_comissao_vendedor?: number | null;
          valor_negociado?: number | null;
          valor_remax?: number | null;
          valor_total_comissao?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "sales_coordenador_org_fk";
            columns: ["coordenador_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sales_corretor_captador_org_fk";
            columns: ["corretor_captador_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sales_corretor_org_fk";
            columns: ["corretor_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sales_corretor_vendedor_org_fk";
            columns: ["corretor_vendedor_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sales_indicador_captador_org_fk";
            columns: ["indicador_captador_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sales_indicador_vendedor_org_fk";
            columns: ["indicador_vendedor_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sales_lider_captador_id_fkey";
            columns: ["lider_captador_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_lider_captador_org_fk";
            columns: ["lider_captador_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sales_lider_vendedor_id_fkey";
            columns: ["lider_vendedor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_lider_vendedor_org_fk";
            columns: ["lider_vendedor_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "sales_organization_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_team_leader_org_fk";
            columns: ["team_leader_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      team_co_leaders: {
        Row: {
          created_at: string;
          organization_id: string;
          team_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          organization_id?: string;
          team_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          organization_id?: string;
          team_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_team_co_leaders_team_id_org_fk";
            columns: ["team_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_team_co_leaders_user_id_org_fk";
            columns: ["user_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "team_co_leaders_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_co_leaders_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      team_members: {
        Row: {
          created_at: string;
          id: string;
          membro_id: string;
          organization_id: string;
          team_id: string;
          tipo: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          membro_id: string;
          organization_id?: string;
          team_id: string;
          tipo?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          membro_id?: string;
          organization_id?: string;
          team_id?: string;
          tipo?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_members_membro_org_fk";
            columns: ["membro_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "team_members_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_members_team_org_fk";
            columns: ["team_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
      team_membership_history: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          membro_id: string;
          organization_id: string;
          origem: string;
          team_id: string;
          vigente_ate: string | null;
          vigente_de: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          membro_id: string;
          organization_id?: string;
          origem?: string;
          team_id: string;
          vigente_ate?: string | null;
          vigente_de: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          membro_id?: string;
          organization_id?: string;
          origem?: string;
          team_id?: string;
          vigente_ate?: string | null;
          vigente_de?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_team_membership_history_membro_id_org_fk";
            columns: ["membro_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_team_membership_history_team_id_org_fk";
            columns: ["team_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "team_membership_history_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_membership_history_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      teams: {
        Row: {
          cor: string;
          created_at: string;
          id: string;
          lider_id: string;
          nome: string;
          organization_id: string;
          parent_team_id: string | null;
          updated_at: string;
        };
        Insert: {
          cor?: string;
          created_at?: string;
          id?: string;
          lider_id: string;
          nome?: string;
          organization_id?: string;
          parent_team_id?: string | null;
          updated_at?: string;
        };
        Update: {
          cor?: string;
          created_at?: string;
          id?: string;
          lider_id?: string;
          nome?: string;
          organization_id?: string;
          parent_team_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teams_lider_org_fk";
            columns: ["lider_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "teams_organization_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teams_parent_org_fk";
            columns: ["parent_team_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "teams_parent_team_id_fkey";
            columns: ["parent_team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      user_preview_audit: {
        Row: {
          action: string;
          actor_user_id: string;
          created_at: string;
          id: number;
          organization_id: string;
          target_user_id: string;
        };
        Insert: {
          action: string;
          actor_user_id: string;
          created_at?: string;
          id?: number;
          organization_id?: string;
          target_user_id: string;
        };
        Update: {
          action?: string;
          actor_user_id?: string;
          created_at?: string;
          id?: number;
          organization_id?: string;
          target_user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mt_1b_user_preview_audit_actor_user_id_org_fk";
            columns: ["actor_user_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "mt_1b_user_preview_audit_target_user_id_org_fk";
            columns: ["target_user_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
          {
            foreignKeyName: "user_preview_audit_org_fk";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          notificar_toda_atualizacao: boolean;
          notificar_whatsapp: boolean;
          organization_id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          notificar_toda_atualizacao?: boolean;
          notificar_whatsapp?: boolean;
          organization_id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          notificar_toda_atualizacao?: boolean;
          notificar_whatsapp?: boolean;
          organization_id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_profile_org_fk";
            columns: ["user_id", "organization_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id", "organization_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      aplicar_descricao_matricula: { Args: { _sale_id: string }; Returns: boolean };
      corrigir_descricao_matricula: { Args: { _sale_id: string; _descricao: string }; Returns: boolean };
      archive_sale_document: {
        Args: { _document_id: string };
        Returns: undefined;
      };
      atribuicao_comercial_resumo: { Args: never; Returns: Json };
      calcular_distribuicao_venda:
        | {
            Args: { p_sale: Database["public"]["Tables"]["sales"]["Row"] };
            Returns: Json;
          }
        | { Args: { p_sale_id: string }; Returns: Json };
      can_cancel_room_reservation: {
        Args: { _actor?: string; _responsible_id: string };
        Returns: boolean;
      };
      can_edit_sale_as_co_leader: {
        Args: { _sale_id: string };
        Returns: boolean;
      };
      can_edit_sale_comissao: {
        Args: { _sale_id: string; _user: string };
        Returns: boolean;
      };
      can_edit_sale_stage: {
        Args: { _sale_id: string; _user: string };
        Returns: boolean;
      };
      can_manage_sale_as_co_leader: {
        Args: { _sale_id: string };
        Returns: boolean;
      };
      can_read_principal_sale_as_co_leader: {
        Args: { _sale_id: string };
        Returns: boolean;
      };
      can_read_sale_juridico_certidao: {
        Args: { _sale_id: string };
        Returns: boolean;
      };
      can_upload_juridico_certidao: {
        Args: { _sale_id: string };
        Returns: boolean;
      };
      can_view_room_reservation: {
        Args: {
          _actor?: string;
          _participant_user_ids: string[];
          _responsible_id: string;
        };
        Returns: boolean;
      };
      can_view_sale: {
        Args: { _sale_id: string; _user: string };
        Returns: boolean;
      };
      cancel_room_reservation: {
        Args: { _reservation_id: string };
        Returns: {
          blocked_until: string;
          late_cancellation_count: number;
          remaining_cancellations: number;
          was_late_cancellation: boolean;
        }[];
      };
      change_sale_status: {
        Args: { _motivo?: string; _new_status: string; _sale_id: string };
        Returns: undefined;
      };
      cliente_historico: {
        Args: { _cliente_id: string; _excluir_sale_id?: string };
        Returns: {
          data: string;
          imovel_endereco: string;
          imovel_id: string;
          papel: string;
          sale_id: string;
        }[];
      };
      comissao_coordenador_dados: { Args: { p_mes: string }; Returns: Json };
      comissoes_carteira_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      comparativo_comissao_6pct: {
        Args: never;
        Returns: {
          codigo_interno: string;
          corretor_id: string;
          data_fechamento: string;
          evento_fechamento: string;
          imovel_id: string;
          modalidade: string;
          parceria_externa: number;
          percentual_comissao: number;
          sale_id: string;
          status: string;
          valor_negociado: number;
          valor_total_comissao: number;
        }[];
      };
      comparativo_comissao_6pct_inconsistencias: {
        Args: never;
        Returns: {
          codigo_interno: string;
          modalidade: string;
          motivo: string;
          sale_id: string;
        }[];
      };
      concluir_lancamento: {
        Args: { p_saldo_confirmado: number; p_sale_id: string };
        Returns: Json;
      };
      criar_lancamento: {
        Args: {
          p_construtora_cnpj: string;
          p_construtora_nome: string;
          p_imovel_id: string;
        };
        Returns: string;
      };
      criar_ocorrencia_completa: { Args: { p_sale_id: string }; Returns: Json };
      criar_ocorrencia_lancamento: {
        Args: { p_sale_id: string };
        Returns: Json;
      };
      current_org_id: { Args: never; Returns: string };
      dashboard_movimentacao_periodo: {
        Args: { _fim: string; _inicio: string };
        Returns: Json;
      };
      dashboard_stats: { Args: never; Returns: Json };
      desempenho_contexto_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      desempenho_detalhe_corretor_proprio_periodo: {
        Args: { _ate: string; _corretor_id: string; _de: string };
        Returns: Json;
      };
      desempenho_detalhe_periodo: {
        Args: {
          _ate: string;
          _corretor_id?: string;
          _de: string;
          _sem_equipe?: boolean;
          _team_id?: string;
        };
        Returns: Json;
      };
      desempenho_empresa_carteira_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      desempenho_empresa_contexto_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      desempenho_empresa_metas_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      desempenho_empresa_ranking_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      desempenho_empresa_resumo_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      desempenho_equipe_carteira_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      desempenho_equipe_contexto_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      desempenho_equipe_metas_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      desempenho_equipe_ranking_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      desempenho_equipe_resumo_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      desempenho_ranking_corretor_proprio_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      desempenho_ranking_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      editar_ocorrencia_lancamento_financeiro: {
        Args: {
          p_linhas: Json;
          p_motivo: string;
          p_occ_patch: Json;
          p_sale_id: string;
          p_sale_patch: Json;
        };
        Returns: Json;
      };
      equipe_vigencias: { Args: never; Returns: Json };
      equipe_vigente: { Args: { _em: string; _user: string }; Returns: string };
      exclusive_actor_active: { Args: { _actor: string }; Returns: boolean };
      exclusive_can_view: {
        Args: { _actor: string; _id: string };
        Returns: boolean;
      };
      exclusive_capture_enabled: { Args: never; Returns: boolean };
      exclusive_capture_set_enabled: {
        Args: { _enabled: boolean };
        Returns: boolean;
      };
      exclusive_create: { Args: { _template: string }; Returns: string };
      exclusive_is_editor: {
        Args: { _actor: string; _id: string };
        Returns: boolean;
      };
      exclusive_is_manager: {
        Args: { _actor: string; _id: string };
        Returns: boolean;
      };
      exclusive_profile_registration: {
        Args: never;
        Returns: {
          cpf: string;
          creci: string;
          user_id: string;
        }[];
      };
      exclusive_register_document: {
        Args: {
          _file_name: string;
          _id: string;
          _kind: string;
          _owner: number;
          _path: string;
        };
        Returns: undefined;
      };
      exclusive_required_fields: {
        Args: { _cpf: string; _creci: string; _form: Json };
        Returns: boolean;
      };
      exclusive_save: {
        Args: {
          _broker_cpf: string;
          _broker_creci: string;
          _form: Json;
          _id: string;
        };
        Returns: undefined;
      };
      exclusive_transition: {
        Args: { _action: string; _detail?: string; _id: string };
        Returns: undefined;
      };
      exclusive_valid_cpf: { Args: { _value: string }; Returns: boolean };
      financeiro_distribuicao_vendas: {
        Args: never;
        Returns: {
          saldo_inicial_imobiliaria: number;
          saldo_liquido_imobiliaria: number;
          sale_id: string;
        }[];
      };
      get_room_reservation_cancellation_status: {
        Args: { _user?: string };
        Returns: {
          blocked_until: string;
          late_cancellation_count: number;
          remaining_cancellations: number;
        }[];
      };
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][];
          _user_id: string;
        };
        Returns: boolean;
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      imprimir_ocorrencias_concluidas: {
        Args: { p_sale_ids: string[] };
        Returns: Json;
      };
      insert_sale_document: {
        Args: {
          _descricao?: string;
          _extraction_status?: string;
          _file_name: string;
          _parte: string;
          _sale_id: string;
          _status?: Database["public"]["Enums"]["doc_status"];
          _storage_path: string;
          _tipo: string;
        };
        Returns: {
          created_at: string;
          deleted_at: string | null;
          deleted_by: string | null;
          descricao: string | null;
          extraction_status: string;
          file_name: string | null;
          id: string;
          motivo_recusa: string | null;
          organization_id: string;
          parte: string;
          sale_id: string;
          status: Database["public"]["Enums"]["doc_status"];
          storage_path: string | null;
          tipo: string;
          updated_at: string;
          uploaded_by: string | null;
          versao: number;
        };
        SetofOptions: {
          from: "*";
          to: "sale_documents";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      is_active_user: { Args: { _user: string }; Returns: boolean };
      is_lead_of: {
        Args: { _lider: string; _membro: string };
        Returns: boolean;
      };
      is_platform_super_admin: { Args: { _user?: string }; Returns: boolean };
      is_sale_locked: { Args: { _sale_id: string }; Returns: boolean };
      leads_team_or_parent: {
        Args: { _team_id: string; _user: string };
        Returns: boolean;
      };
      legacy_default_org_id: { Args: never; Returns: string };
      link_conta_max_identity_by_email: {
        Args: { p_email: string; p_workos_user_id: string };
        Returns: string;
      };
      list_active_corretores: {
        Args: never;
        Returns: {
          id: string;
          nome: string;
        }[];
      };
      list_active_gestores: {
        Args: never;
        Returns: {
          id: string;
          nome: string;
        }[];
      };
      list_active_team_leaders: {
        Args: never;
        Returns: {
          id: string;
          nome: string;
        }[];
      };
      list_active_users: {
        Args: never;
        Returns: {
          id: string;
          nome: string;
        }[];
      };
      list_public_positioning_regions: {
        Args: never;
        Returns: {
          cidade: string;
          corretores: number;
          id: number;
          nome: string;
          tipo: string;
          zona: string;
        }[];
      };
      list_public_specialists: {
        Args: { _region_id?: number; _search?: string };
        Returns: {
          avatar_url: string;
          id: string;
          instagram_url: string;
          nome: string;
          pagina_pessoal_url: string;
          regioes: Json;
          telefone: string;
        }[];
      };
      list_room_occupancy: {
        Args: never;
        Returns: {
          end_time: string;
          id: string;
          reservation_group_id: string;
          reserved_date: string;
          responsible_id: string;
          responsible_name: string;
          room: string;
          start_time: string;
        }[];
      };
      list_room_reservation_users: {
        Args: never;
        Returns: {
          id: string;
          nome: string;
        }[];
      };
      list_vendas_comerciais_paginadas: {
        Args: {
          _ate?: string;
          _corretor_ids?: string[];
          _desde?: string;
          _midia?: string;
          _page?: number;
          _page_size?: number;
          _q?: string;
          _status?: string;
          _statuses?: string[];
        };
        Returns: Json;
      };
      list_vendas_comerciais_paginadas_fila: {
        Args: {
          _ate?: string;
          _corretor_ids?: string[];
          _desde?: string;
          _midia?: string;
          _page?: number;
          _page_size?: number;
          _q?: string;
          _status?: string;
          _statuses?: string[];
        };
        Returns: Json;
      };
      marcar_contrato_assinado_e_criar_ocorrencia: {
        Args: { _sale_id: string };
        Returns: undefined;
      };
      metas_progresso: { Args: { _mes: string }; Returns: Json };
      metas_progresso_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      metricas_venda_sem_parceria: {
        Args: never;
        Returns: {
          comissao_bruta: number;
          parceria_externa: number;
          sale_id: string;
          vgv: number;
        }[];
      };
      mt_1b_gate: { Args: { _target_org?: string }; Returns: boolean };
      mt_1c_relative_path: { Args: { _name: string }; Returns: string };
      mt_1c_storage_scope: {
        Args: { _bucket: string; _name: string; _new_only?: boolean };
        Returns: boolean;
      };
      mt_1d_is_service: { Args: never; Returns: boolean };
      mt_2a_provision_user: {
        Args: { _email: string; _id: string; _meta: Json; _org: string };
        Returns: undefined;
      };
      mt_2b_org_auth_users: {
        Args: { _org: string };
        Returns: {
          email: string;
          last_sign_in_at: string;
          user_id: string;
        }[];
      };
      participacoes_comerciais_validas: {
        Args: never;
        Returns: {
          conta_equipe: boolean;
          sale_id: string;
          team_id: string;
          user_id: string;
          valor_equipe: number;
          valor_individual: number;
          venda_em: string;
        }[];
      };
      platform_create_organization: {
        Args: { _nome: string; _slug: string };
        Returns: string;
      };
      platform_cancel_sale: {
        Args: { _motivo: string; _sale_id: string };
        Returns: undefined;
      };
      platform_set_organization_status: {
        Args: { _id: string; _status: string };
        Returns: undefined;
      };
      platform_update_organization: {
        Args: { _id: string; _nome: string; _slug: string };
        Returns: undefined;
      };
      platform_update_organization_profile: {
        Args: {
          _cnpj: string;
          _cor_primaria: string;
          _cor_secundaria: string;
          _id: string;
        };
        Returns: undefined;
      };
      producao_por_pessoa_dados: { Args: never; Returns: Json };
      record_user_preview_event: {
        Args: { p_action: string; p_target_user_id: string };
        Returns: undefined;
      };
      relatorio_ocorrencias_concluidas: { Args: never; Returns: Json };
      resumo_desempenho_periodo: {
        Args: { _ate: string; _de: string };
        Returns: Json;
      };
      review_positioning_region_suggestion: {
        Args: {
          _cidade?: string;
          _decision: string;
          _nome?: string;
          _suggestion_id: string;
          _tipo?: string;
          _zona?: string;
        };
        Returns: number;
      };
      sale_management_capabilities: {
        Args: { _sale_id: string };
        Returns: Json;
      };
      salvar_divisao_comissao_lancamento: {
        Args: { p_linhas: Json; p_sale_id: string };
        Returns: Json;
      };
      save_my_positioning: {
        Args: { _public_enabled: boolean; _region_ids: number[] };
        Returns: undefined;
      };
      sees_own_team_leader: {
        Args: { _profile_id: string; _user: string };
        Returns: boolean;
      };
      sees_team: { Args: { _team_id: string; _user: string }; Returns: boolean };
      sincronizar_base_financeira_ocorrencia: {
        Args: { p_sale_id: string };
        Returns: undefined;
      };
      sincronizar_ocorrencia_antes_financeiro: {
        Args: { p_sale_id: string };
        Returns: undefined;
      };
      sincronizar_previsao_ocorrencia_pendente: {
        Args: { p_sale_id: string };
        Returns: undefined;
      };
      status_exige_composicao_pagamento_valida: {
        Args: { p_status: Database["public"]["Enums"]["sale_status"] };
        Returns: boolean;
      };
      submit_positioning_region_suggestion: {
        Args: { _cidade: string; _nome: string; _tipo: string; _zona: string };
        Returns: string;
      };
      sync_occurrence_commissions: {
        Args: { _sale_id: string };
        Returns: undefined;
      };
      update_contrato_pendencia: {
        Args: {
          _libera_assinatura: boolean;
          _pendencia_descricao: string;
          _sale_id: string;
        };
        Returns: undefined;
      };
      user_org: { Args: { _user: string }; Returns: string };
      validar_composicao_pagamento_venda: {
        Args: { p_sale_id: string };
        Returns: Json;
      };
      validar_participantes_internos_venda: {
        Args: { p_sale_id: string };
        Returns: Json;
      };
      validar_previsao_recebimento: {
        Args: { p_occ: Database["public"]["Tables"]["occurrences"]["Row"] };
        Returns: Json;
      };
      vendas_comerciais_canonicas: {
        Args: never;
        Returns: {
          codigo_interno: string;
          comissao_bruta: number;
          comissao_propria: number;
          corretor_id: string;
          data_fechamento: string;
          imovel_id: string;
          modalidade: string;
          occurrence_concluida_count: number;
          occurrence_count: number;
          parceria_externa: number;
          percentual_comissao: number;
          sale_id: string;
          status: string;
          valor_negociado: number;
          valor_total_comissao: number;
          venda_em: string;
          vgv_proprio: number;
        }[];
      };
      vendas_comerciais_validas: {
        Args: never;
        Returns: {
          sale_id: string;
          venda_em: string;
        }[];
      };
    };
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
        | "staff";
      doc_status: "pendente" | "enviado" | "aprovado" | "recusado";
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
        | "ocorrencia_devolvida_gestor";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

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
        "staff",
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
} as const;
