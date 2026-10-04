export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_calls: {
        Row: {
          cost_usd: number | null
          created_at: string
          group_id: string | null
          id: string
          input_tokens: number | null
          line_id: string | null
          model: string
          outcome: string
          output_tokens: number | null
          request_id: string | null
          reserved_usd: number
          settled_at: string | null
        }
        Insert: {
          cost_usd?: number | null
          created_at?: string
          group_id?: string | null
          id?: string
          input_tokens?: number | null
          line_id?: string | null
          model: string
          outcome?: string
          output_tokens?: number | null
          request_id?: string | null
          reserved_usd: number
          settled_at?: string | null
        }
        Update: {
          cost_usd?: number | null
          created_at?: string
          group_id?: string | null
          id?: string
          input_tokens?: number | null
          line_id?: string | null
          model?: string
          outcome?: string
          output_tokens?: number | null
          request_id?: string | null
          reserved_usd?: number
          settled_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_calls_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_calls_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_calls_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "ai_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_lines: {
        Row: {
          attempts: number
          cost_usd: number
          created_at: string
          fact_hash: string
          facts: Json
          game_id: string | null
          group_id: string
          hidden_at: string | null
          hidden_by: string | null
          id: string
          input_tokens: number
          kind: string
          model: string
          output_tokens: number
          player_id: string | null
          prompt_version: string
          published_at: string | null
          reject_reason: string | null
          status: string
          subject: string
          text: string | null
          token_map: Json
          updated_at: string
          week_start: string | null
        }
        Insert: {
          attempts?: number
          cost_usd?: number
          created_at?: string
          fact_hash: string
          facts: Json
          game_id?: string | null
          group_id: string
          hidden_at?: string | null
          hidden_by?: string | null
          id?: string
          input_tokens?: number
          kind: string
          model: string
          output_tokens?: number
          player_id?: string | null
          prompt_version: string
          published_at?: string | null
          reject_reason?: string | null
          status?: string
          subject: string
          text?: string | null
          token_map?: Json
          updated_at?: string
          week_start?: string | null
        }
        Update: {
          attempts?: number
          cost_usd?: number
          created_at?: string
          fact_hash?: string
          facts?: Json
          game_id?: string | null
          group_id?: string
          hidden_at?: string | null
          hidden_by?: string | null
          id?: string
          input_tokens?: number
          kind?: string
          model?: string
          output_tokens?: number
          player_id?: string | null
          prompt_version?: string
          published_at?: string | null
          reject_reason?: string | null
          status?: string
          subject?: string
          text?: string | null
          token_map?: Json
          updated_at?: string
          week_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_lines_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_lines_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_lines_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_lines_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_lines_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_lines_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_lines_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_settings: {
        Row: {
          calls_enabled: boolean
          global_monthly_cap_usd: number
          id: boolean
          updated_at: string
        }
        Insert: {
          calls_enabled?: boolean
          global_monthly_cap_usd?: number
          id?: boolean
          updated_at?: string
        }
        Update: {
          calls_enabled?: boolean
          global_monthly_cap_usd?: number
          id?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      companion_commands: {
        Row: {
          acked_at: string | null
          attempts: number
          created_at: string
          error: string | null
          expires_at: string
          group_id: string
          id: string
          kind: Database["public"]["Enums"]["companion_command_kind"]
          payload: Json
          result: Json | null
          sent_at: string | null
          status: Database["public"]["Enums"]["companion_command_status"]
          target_player_id: string
        }
        Insert: {
          acked_at?: string | null
          attempts?: number
          created_at?: string
          error?: string | null
          expires_at?: string
          group_id: string
          id?: string
          kind: Database["public"]["Enums"]["companion_command_kind"]
          payload?: Json
          result?: Json | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["companion_command_status"]
          target_player_id: string
        }
        Update: {
          acked_at?: string | null
          attempts?: number
          created_at?: string
          error?: string | null
          expires_at?: string
          group_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["companion_command_kind"]
          payload?: Json
          result?: Json | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["companion_command_status"]
          target_player_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "companion_commands_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_commands_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_commands_target_player_id_fkey"
            columns: ["target_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_commands_target_player_id_fkey"
            columns: ["target_player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      companion_tokens: {
        Row: {
          created_at: string
          group_id: string
          id: string
          label: string | null
          last_seen_at: string | null
          player_id: string
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          label?: string | null
          last_seen_at?: string | null
          player_id: string
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          label?: string | null
          last_seen_at?: string | null
          player_id?: string
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "companion_tokens_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_tokens_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_tokens_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companion_tokens_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_mysteries: {
        Row: {
          active_from: string
          category: string
          challenge_number: number
          created_at: string
          day: string
          expires_at: string
          first_correct_at: string | null
          game_id: string
          group_id: string
          hook: Json
          id: string
          interesting_score: number
          kind: string
          mystery_player_id: string
          suspect_ids: string[]
        }
        Insert: {
          active_from: string
          category: string
          challenge_number: number
          created_at?: string
          day: string
          expires_at: string
          first_correct_at?: string | null
          game_id: string
          group_id: string
          hook: Json
          id?: string
          interesting_score: number
          kind?: string
          mystery_player_id: string
          suspect_ids: string[]
        }
        Update: {
          active_from?: string
          category?: string
          challenge_number?: number
          created_at?: string
          day?: string
          expires_at?: string
          first_correct_at?: string | null
          game_id?: string
          group_id?: string
          hook?: Json
          id?: string
          interesting_score?: number
          kind?: string
          mystery_player_id?: string
          suspect_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "daily_mysteries_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_mysteries_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_mysteries_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_mysteries_mystery_player_id_fkey"
            columns: ["mystery_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_mysteries_mystery_player_id_fkey"
            columns: ["mystery_player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_mystery_attempts: {
        Row: {
          challenge_id: string
          clues_used: number
          completion_time_ms: number
          correct: boolean
          created_at: string
          guessed_player_id: string
          id: string
          visitor_id: string
        }
        Insert: {
          challenge_id: string
          clues_used: number
          completion_time_ms: number
          correct: boolean
          created_at?: string
          guessed_player_id: string
          id?: string
          visitor_id: string
        }
        Update: {
          challenge_id?: string
          clues_used?: number
          completion_time_ms?: number
          correct?: boolean
          created_at?: string
          guessed_player_id?: string
          id?: string
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_mystery_attempts_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "daily_mysteries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_mystery_attempts_guessed_player_id_fkey"
            columns: ["guessed_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_mystery_attempts_guessed_player_id_fkey"
            columns: ["guessed_player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_mystery_clues: {
        Row: {
          challenge_id: string
          clue_type: string
          clue_value: string
          id: string
          reveal_order: number
        }
        Insert: {
          challenge_id: string
          clue_type: string
          clue_value: string
          id?: string
          reveal_order: number
        }
        Update: {
          challenge_id?: string
          clue_type?: string
          clue_value?: string
          id?: string
          reveal_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "daily_mystery_clues_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "daily_mysteries"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_mystery_sessions: {
        Row: {
          challenge_id: string
          clues_revealed: number
          last_request_at: string
          request_count: number
          started_at: string
          visitor_id: string
        }
        Insert: {
          challenge_id: string
          clues_revealed?: number
          last_request_at: string
          request_count?: number
          started_at: string
          visitor_id: string
        }
        Update: {
          challenge_id?: string
          clues_revealed?: number
          last_request_at?: string
          request_count?: number
          started_at?: string
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_mystery_sessions_challenge_id_fkey"
            columns: ["challenge_id"]
            isOneToOne: false
            referencedRelation: "daily_mysteries"
            referencedColumns: ["id"]
          },
        ]
      }
      discord_config: {
        Row: {
          blue_voice_channel_id: string | null
          created_at: string
          group_id: string
          guild_id: string
          lobby_voice_channel_id: string | null
          red_voice_channel_id: string | null
          results_channel_id: string | null
          test_post_at: string | null
          test_post_error: string | null
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          blue_voice_channel_id?: string | null
          created_at?: string
          group_id: string
          guild_id: string
          lobby_voice_channel_id?: string | null
          red_voice_channel_id?: string | null
          results_channel_id?: string | null
          test_post_at?: string | null
          test_post_error?: string | null
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          blue_voice_channel_id?: string | null
          created_at?: string
          group_id?: string
          guild_id?: string
          lobby_voice_channel_id?: string | null
          red_voice_channel_id?: string | null
          results_channel_id?: string | null
          test_post_at?: string | null
          test_post_error?: string | null
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discord_config_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discord_config_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
        ]
      }
      discord_connect_states: {
        Row: {
          auth_user_id: string
          created_at: string
          expires_at: string
          group_id: string
          state_hash: string
          used_at: string | null
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          expires_at: string
          group_id: string
          state_hash: string
          used_at?: string | null
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          expires_at?: string
          group_id?: string
          state_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discord_connect_states_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discord_connect_states_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
        ]
      }
      fearless_state: {
        Row: {
          group_id: string
          id: number
          reset_at: string
          reset_by: string | null
          updated_at: string
        }
        Insert: {
          group_id: string
          id?: number
          reset_at?: string
          reset_by?: string | null
          updated_at?: string
        }
        Update: {
          group_id?: string
          id?: number
          reset_at?: string
          reset_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fearless_state_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fearless_state_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fearless_state_reset_by_fkey"
            columns: ["reset_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fearless_state_reset_by_fkey"
            columns: ["reset_by"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      game_facts: {
        Row: {
          facts: Json
          facts_version: number
          game_id: string
          group_id: string
          updated_at: string
        }
        Insert: {
          facts: Json
          facts_version: number
          game_id: string
          group_id: string
          updated_at?: string
        }
        Update: {
          facts?: Json
          facts_version?: number
          game_id?: string
          group_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_facts_game_group_fkey"
            columns: ["game_id", "group_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id", "group_id"]
          },
          {
            foreignKeyName: "game_facts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_facts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
        ]
      }
      game_players: {
        Row: {
          assists: number
          award: string | null
          base_mu_after: number | null
          champion_id: number | null
          counts_for_role_inference: boolean
          cs: number
          damage_self_mitigated: number | null
          damage_to_champs: number
          damage_to_objectives: number | null
          deaths: number
          fold_p: number | null
          game_id: string
          gold: number
          group_id: string
          k: number | null
          kills: number
          mu_after: number | null
          mu_before: number | null
          player_id: string
          r_after: number | null
          r_before: number | null
          rated_games_before: number | null
          role: Database["public"]["Enums"]["player_role"] | null
          share_rank: number | null
          side: number
          sigma_after: number | null
          sigma_before: number | null
          vision_score: number | null
          week_fold_p: number | null
          week_games_before: number | null
          week_k: number | null
          week_r_after: number | null
          week_r_before: number | null
        }
        Insert: {
          assists?: number
          award?: string | null
          base_mu_after?: number | null
          champion_id?: number | null
          counts_for_role_inference?: boolean
          cs?: number
          damage_self_mitigated?: number | null
          damage_to_champs?: number
          damage_to_objectives?: number | null
          deaths?: number
          fold_p?: number | null
          game_id: string
          gold?: number
          group_id: string
          k?: number | null
          kills?: number
          mu_after?: number | null
          mu_before?: number | null
          player_id: string
          r_after?: number | null
          r_before?: number | null
          rated_games_before?: number | null
          role?: Database["public"]["Enums"]["player_role"] | null
          share_rank?: number | null
          side: number
          sigma_after?: number | null
          sigma_before?: number | null
          vision_score?: number | null
          week_fold_p?: number | null
          week_games_before?: number | null
          week_k?: number | null
          week_r_after?: number | null
          week_r_before?: number | null
        }
        Update: {
          assists?: number
          award?: string | null
          base_mu_after?: number | null
          champion_id?: number | null
          counts_for_role_inference?: boolean
          cs?: number
          damage_self_mitigated?: number | null
          damage_to_champs?: number
          damage_to_objectives?: number | null
          deaths?: number
          fold_p?: number | null
          game_id?: string
          gold?: number
          group_id?: string
          k?: number | null
          kills?: number
          mu_after?: number | null
          mu_before?: number | null
          player_id?: string
          r_after?: number | null
          r_before?: number | null
          rated_games_before?: number | null
          role?: Database["public"]["Enums"]["player_role"] | null
          share_rank?: number | null
          side?: number
          sigma_after?: number | null
          sigma_before?: number | null
          vision_score?: number | null
          week_fold_p?: number | null
          week_games_before?: number | null
          week_k?: number | null
          week_r_after?: number | null
          week_r_before?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "game_players_game_group_fkey"
            columns: ["game_id", "group_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id", "group_id"]
          },
          {
            foreignKeyName: "game_players_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_players_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          created_at: string
          duration_s: number
          game_mode: string | null
          group_id: string
          id: string
          lcu_game_id: number
          lobby_id: string | null
          mode: string | null
          rated: boolean
          raw: Json
          rule: string | null
          rule_check: Json | null
          rule_checked: boolean
          rule_class_tag: string | null
          rule_region_blue: string | null
          rule_region_red: string | null
          source: Database["public"]["Enums"]["game_source"]
          started_at: string
          winning_side: number
        }
        Insert: {
          created_at?: string
          duration_s: number
          game_mode?: string | null
          group_id: string
          id?: string
          lcu_game_id: number
          lobby_id?: string | null
          mode?: string | null
          rated?: boolean
          raw: Json
          rule?: string | null
          rule_check?: Json | null
          rule_checked?: boolean
          rule_class_tag?: string | null
          rule_region_blue?: string | null
          rule_region_red?: string | null
          source?: Database["public"]["Enums"]["game_source"]
          started_at: string
          winning_side: number
        }
        Update: {
          created_at?: string
          duration_s?: number
          game_mode?: string | null
          group_id?: string
          id?: string
          lcu_game_id?: number
          lobby_id?: string | null
          mode?: string | null
          rated?: boolean
          raw?: Json
          rule?: string | null
          rule_check?: Json | null
          rule_checked?: boolean
          rule_class_tag?: string | null
          rule_region_blue?: string | null
          rule_region_red?: string | null
          source?: Database["public"]["Enums"]["game_source"]
          started_at?: string
          winning_side?: number
        }
        Relationships: [
          {
            foreignKeyName: "games_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_lobby_id_fkey"
            columns: ["lobby_id"]
            isOneToOne: false
            referencedRelation: "lobbies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_mode_fkey"
            columns: ["mode"]
            isOneToOne: false
            referencedRelation: "modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_rule_fkey"
            columns: ["rule"]
            isOneToOne: false
            referencedRelation: "modes"
            referencedColumns: ["id"]
          },
        ]
      }
      group_invites: {
        Row: {
          code: string
          group_id: string
          rotated_at: string
          rotated_by: string | null
        }
        Insert: {
          code: string
          group_id: string
          rotated_at?: string
          rotated_by?: string | null
        }
        Update: {
          code?: string
          group_id?: string
          rotated_at?: string
          rotated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_invites_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_invites_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
        ]
      }
      group_live: {
        Row: {
          changed_at: string
          group_id: string
          kind: string
          version: number
        }
        Insert: {
          changed_at?: string
          group_id: string
          kind: string
          version?: number
        }
        Update: {
          changed_at?: string
          group_id?: string
          kind?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_live_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_live_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
        ]
      }
      group_memberships: {
        Row: {
          ai_opt_out: boolean
          backfill_approved_at: string | null
          backfill_requested_at: string | null
          created_at: string
          group_id: string
          player_id: string
          role: string
        }
        Insert: {
          ai_opt_out?: boolean
          backfill_approved_at?: string | null
          backfill_requested_at?: string | null
          created_at?: string
          group_id: string
          player_id: string
          role?: string
        }
        Update: {
          ai_opt_out?: boolean
          backfill_approved_at?: string | null
          backfill_requested_at?: string | null
          created_at?: string
          group_id?: string
          player_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      group_modes: {
        Row: {
          group_id: string
          mode: string
          pending_class_tag: string | null
          pending_region_blue: string | null
          pending_region_red: string | null
          pending_rule: string | null
          pending_set_by: string | null
          rated_override: boolean | null
          set_by: string | null
          updated_at: string
        }
        Insert: {
          group_id: string
          mode?: string
          pending_class_tag?: string | null
          pending_region_blue?: string | null
          pending_region_red?: string | null
          pending_rule?: string | null
          pending_set_by?: string | null
          rated_override?: boolean | null
          set_by?: string | null
          updated_at?: string
        }
        Update: {
          group_id?: string
          mode?: string
          pending_class_tag?: string | null
          pending_region_blue?: string | null
          pending_region_red?: string | null
          pending_rule?: string | null
          pending_set_by?: string | null
          rated_override?: boolean | null
          set_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_modes_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_modes_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: true
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_modes_mode_fkey"
            columns: ["mode"]
            isOneToOne: false
            referencedRelation: "modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_modes_pending_rule_fkey"
            columns: ["pending_rule"]
            isOneToOne: false
            referencedRelation: "modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_modes_pending_set_by_fkey"
            columns: ["pending_set_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_modes_pending_set_by_fkey"
            columns: ["pending_set_by"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_modes_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_modes_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          ai_lines_enabled: boolean
          ai_monthly_cap_usd: number
          created_at: string
          created_by: string | null
          id: string
          name: string
          premium: boolean
          premium_changed_at: string | null
          ratings_since: string | null
          slug: string
        }
        Insert: {
          ai_lines_enabled?: boolean
          ai_monthly_cap_usd?: number
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          premium?: boolean
          premium_changed_at?: string | null
          ratings_since?: string | null
          slug: string
        }
        Update: {
          ai_lines_enabled?: boolean
          ai_monthly_cap_usd?: number
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          premium?: boolean
          premium_changed_at?: string | null
          ratings_since?: string | null
          slug?: string
        }
        Relationships: []
      }
      lobbies: {
        Row: {
          created_at: string
          group_id: string
          id: string
          kickoff_at: string | null
          kickoff_blue: string[] | null
          kickoff_blue_win_prob: number | null
          kickoff_kind: string | null
          kickoff_odds_model: string | null
          kickoff_red: string[] | null
          kickoff_swapped: boolean
          lcu_party_id: string
          lobby_name: string | null
          lobby_password: string | null
          lock_class_tag: string | null
          lock_mode: string | null
          lock_rated: boolean | null
          lock_region_blue: string | null
          lock_region_red: string | null
          lock_rule: string | null
          locked_at: string | null
          reported_by_player_id: string | null
          status: Database["public"]["Enums"]["lobby_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          kickoff_at?: string | null
          kickoff_blue?: string[] | null
          kickoff_blue_win_prob?: number | null
          kickoff_kind?: string | null
          kickoff_odds_model?: string | null
          kickoff_red?: string[] | null
          kickoff_swapped?: boolean
          lcu_party_id: string
          lobby_name?: string | null
          lobby_password?: string | null
          lock_class_tag?: string | null
          lock_mode?: string | null
          lock_rated?: boolean | null
          lock_region_blue?: string | null
          lock_region_red?: string | null
          lock_rule?: string | null
          locked_at?: string | null
          reported_by_player_id?: string | null
          status?: Database["public"]["Enums"]["lobby_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          kickoff_at?: string | null
          kickoff_blue?: string[] | null
          kickoff_blue_win_prob?: number | null
          kickoff_kind?: string | null
          kickoff_odds_model?: string | null
          kickoff_red?: string[] | null
          kickoff_swapped?: boolean
          lcu_party_id?: string
          lobby_name?: string | null
          lobby_password?: string | null
          lock_class_tag?: string | null
          lock_mode?: string | null
          lock_rated?: boolean | null
          lock_region_blue?: string | null
          lock_region_red?: string | null
          lock_rule?: string | null
          locked_at?: string | null
          reported_by_player_id?: string | null
          status?: Database["public"]["Enums"]["lobby_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lobbies_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobbies_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobbies_lock_mode_fkey"
            columns: ["lock_mode"]
            isOneToOne: false
            referencedRelation: "modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobbies_lock_rule_fkey"
            columns: ["lock_rule"]
            isOneToOne: false
            referencedRelation: "modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobbies_reported_by_player_id_fkey"
            columns: ["reported_by_player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobbies_reported_by_player_id_fkey"
            columns: ["reported_by_player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      lobby_members: {
        Row: {
          created_at: string
          is_spectator: boolean
          lobby_id: string
          player_id: string
          role: Database["public"]["Enums"]["player_role"] | null
          role_override: Database["public"]["Enums"]["player_role"] | null
          side: number | null
        }
        Insert: {
          created_at?: string
          is_spectator?: boolean
          lobby_id: string
          player_id: string
          role?: Database["public"]["Enums"]["player_role"] | null
          role_override?: Database["public"]["Enums"]["player_role"] | null
          side?: number | null
        }
        Update: {
          created_at?: string
          is_spectator?: boolean
          lobby_id?: string
          player_id?: string
          role?: Database["public"]["Enums"]["player_role"] | null
          role_override?: Database["public"]["Enums"]["player_role"] | null
          side?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lobby_members_lobby_id_fkey"
            columns: ["lobby_id"]
            isOneToOne: false
            referencedRelation: "lobbies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobby_members_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lobby_members_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      modes: {
        Row: {
          created_at: string
          id: string
          rated_default: boolean
        }
        Insert: {
          created_at?: string
          id: string
          rated_default?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          rated_default?: boolean
        }
        Relationships: []
      }
      pairing_attempts: {
        Row: {
          attempted_at: string
          id: number
          ip_hash: string
        }
        Insert: {
          attempted_at?: string
          id?: never
          ip_hash: string
        }
        Update: {
          attempted_at?: string
          id?: never
          ip_hash?: string
        }
        Relationships: []
      }
      pairing_codes: {
        Row: {
          auth_user_id: string
          code_hash: string
          created_at: string
          discord_id: string
          expires_at: string
          group_id: string
          used_at: string | null
        }
        Insert: {
          auth_user_id: string
          code_hash: string
          created_at?: string
          discord_id: string
          expires_at: string
          group_id: string
          used_at?: string | null
        }
        Update: {
          auth_user_id?: string
          code_hash?: string
          created_at?: string
          discord_id?: string
          expires_at?: string
          group_id?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pairing_codes_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pairing_codes_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          backfill_approved_at: string | null
          backfill_requested_at: string | null
          created_at: string
          discord_id: string | null
          display_name: string | null
          game_name: string | null
          id: string
          is_admin: boolean
          main_role: Database["public"]["Enums"]["player_role"] | null
          puuid: string
          rank_division: string | null
          rank_lp: number | null
          rank_tier: string | null
          rank_updated_at: string | null
          role_tonight: Database["public"]["Enums"]["player_role"] | null
          role_tonight_until: string | null
          roles_counted: number
          roles_inferred_at: string | null
          secondary_role: Database["public"]["Enums"]["player_role"] | null
          summoner_id: string | null
          tag_line: string | null
        }
        Insert: {
          backfill_approved_at?: string | null
          backfill_requested_at?: string | null
          created_at?: string
          discord_id?: string | null
          display_name?: string | null
          game_name?: string | null
          id?: string
          is_admin?: boolean
          main_role?: Database["public"]["Enums"]["player_role"] | null
          puuid: string
          rank_division?: string | null
          rank_lp?: number | null
          rank_tier?: string | null
          rank_updated_at?: string | null
          role_tonight?: Database["public"]["Enums"]["player_role"] | null
          role_tonight_until?: string | null
          roles_counted?: number
          roles_inferred_at?: string | null
          secondary_role?: Database["public"]["Enums"]["player_role"] | null
          summoner_id?: string | null
          tag_line?: string | null
        }
        Update: {
          backfill_approved_at?: string | null
          backfill_requested_at?: string | null
          created_at?: string
          discord_id?: string | null
          display_name?: string | null
          game_name?: string | null
          id?: string
          is_admin?: boolean
          main_role?: Database["public"]["Enums"]["player_role"] | null
          puuid?: string
          rank_division?: string | null
          rank_lp?: number | null
          rank_tier?: string | null
          rank_updated_at?: string | null
          role_tonight?: Database["public"]["Enums"]["player_role"] | null
          role_tonight_until?: string | null
          roles_counted?: number
          roles_inferred_at?: string | null
          secondary_role?: Database["public"]["Enums"]["player_role"] | null
          summoner_id?: string | null
          tag_line?: string | null
        }
        Relationships: []
      }
      ratings: {
        Row: {
          games: number
          group_id: string
          mu: number | null
          ordinal: number | null
          player_id: string
          r: number | null
          seed_mu: number | null
          seed_rank_division: string | null
          seed_rank_tier: string | null
          seed_sigma: number | null
          sigma: number | null
          updated_at: string
          wins: number
        }
        Insert: {
          games?: number
          group_id: string
          mu?: number | null
          ordinal?: number | null
          player_id: string
          r?: number | null
          seed_mu?: number | null
          seed_rank_division?: string | null
          seed_rank_tier?: string | null
          seed_sigma?: number | null
          sigma?: number | null
          updated_at?: string
          wins?: number
        }
        Update: {
          games?: number
          group_id?: string
          mu?: number | null
          ordinal?: number | null
          player_id?: string
          r?: number | null
          seed_mu?: number | null
          seed_rank_division?: string | null
          seed_rank_tier?: string | null
          seed_sigma?: number | null
          sigma?: number | null
          updated_at?: string
          wins?: number
        }
        Relationships: [
          {
            foreignKeyName: "ratings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      splits: {
        Row: {
          blue: Json
          blue_win_prob: number
          created_at: string
          explanation: string
          gap: number
          id: string
          is_chosen: boolean
          lobby_id: string
          odds_model: string
          off_role_count: number
          rank: number
          red: Json
          roster_key: string
          score: number
          score_parts: Json | null
        }
        Insert: {
          blue: Json
          blue_win_prob: number
          created_at?: string
          explanation: string
          gap: number
          id?: string
          is_chosen?: boolean
          lobby_id: string
          odds_model?: string
          off_role_count: number
          rank: number
          red: Json
          roster_key: string
          score: number
          score_parts?: Json | null
        }
        Update: {
          blue?: Json
          blue_win_prob?: number
          created_at?: string
          explanation?: string
          gap?: number
          id?: string
          is_chosen?: boolean
          lobby_id?: string
          odds_model?: string
          off_role_count?: number
          rank?: number
          red?: Json
          roster_key?: string
          score?: number
          score_parts?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "splits_lobby_id_fkey"
            columns: ["lobby_id"]
            isOneToOne: false
            referencedRelation: "lobbies"
            referencedColumns: ["id"]
          },
        ]
      }
      window_posts: {
        Row: {
          attempts: number
          claimed_at: string
          group_id: string
          kind: string
          posted_at: string | null
          reason: string | null
          window_start: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string
          group_id: string
          kind: string
          posted_at?: string | null
          reason?: string | null
          window_start: string
        }
        Update: {
          attempts?: number
          claimed_at?: string
          group_id?: string
          kind?: string
          posted_at?: string | null
          reason?: string | null
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "window_posts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "window_posts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      group_member_game_counts: {
        Row: {
          games: number | null
          group_id: string | null
          last_played_at: string | null
          player_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "game_players_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_players_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_players_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      group_members_public: {
        Row: {
          group_id: string | null
          player_id: string | null
        }
        Insert: {
          group_id?: string | null
          player_id?: string | null
        }
        Update: {
          group_id?: string | null
          player_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players_public"
            referencedColumns: ["id"]
          },
        ]
      }
      groups_public: {
        Row: {
          id: string | null
          name: string | null
          ratings_since: string | null
          slug: string | null
        }
        Insert: {
          id?: string | null
          name?: string | null
          ratings_since?: string | null
          slug?: string | null
        }
        Update: {
          id?: string | null
          name?: string | null
          ratings_since?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      players_public: {
        Row: {
          created_at: string | null
          display_name: string | null
          game_name: string | null
          id: string | null
          is_admin: boolean | null
          main_role: Database["public"]["Enums"]["player_role"] | null
          puuid: string | null
          rank_division: string | null
          rank_lp: number | null
          rank_tier: string | null
          rank_updated_at: string | null
          secondary_role: Database["public"]["Enums"]["player_role"] | null
          summoner_id: string | null
          tag_line: string | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          game_name?: string | null
          id?: string | null
          is_admin?: boolean | null
          main_role?: Database["public"]["Enums"]["player_role"] | null
          puuid?: string | null
          rank_division?: string | null
          rank_lp?: number | null
          rank_tier?: string | null
          rank_updated_at?: string | null
          secondary_role?: Database["public"]["Enums"]["player_role"] | null
          summoner_id?: string | null
          tag_line?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          game_name?: string | null
          id?: string | null
          is_admin?: boolean | null
          main_role?: Database["public"]["Enums"]["player_role"] | null
          puuid?: string | null
          rank_division?: string | null
          rank_lp?: number | null
          rank_tier?: string | null
          rank_updated_at?: string | null
          secondary_role?: Database["public"]["Enums"]["player_role"] | null
          summoner_id?: string | null
          tag_line?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      ai_month_spend: {
        Args: { p_group_id: string; p_month_end: string; p_month_start: string }
        Returns: {
          calls_enabled: boolean
          global_cap_usd: number
          global_spent_usd: number
          group_cap_usd: number
          group_spent_usd: number
          lines_enabled: boolean
          premium: boolean
        }[]
      }
      ai_reserve_call: {
        Args: {
          p_group_id: string
          p_line_id?: string
          p_model: string
          p_month_end: string
          p_month_start: string
          p_worst_case_usd: number
        }
        Returns: Json
      }
      ai_settle_call: {
        Args: {
          p_call_id: string
          p_cost_usd: number
          p_input_tokens: number
          p_outcome: string
          p_output_tokens: number
          p_request_id: string
        }
        Returns: boolean
      }
      apply_game_player_ratings: {
        Args: { p_group: string; p_only_unrated?: boolean; p_rows: Json }
        Returns: number
      }
      bootstrap_admin: {
        Args: { p_puuid: string }
        Returns: {
          backfill_approved_at: string | null
          backfill_requested_at: string | null
          created_at: string
          discord_id: string | null
          display_name: string | null
          game_name: string | null
          id: string
          is_admin: boolean
          main_role: Database["public"]["Enums"]["player_role"] | null
          puuid: string
          rank_division: string | null
          rank_lp: number | null
          rank_tier: string | null
          rank_updated_at: string | null
          role_tonight: Database["public"]["Enums"]["player_role"] | null
          role_tonight_until: string | null
          roles_counted: number
          roles_inferred_at: string | null
          secondary_role: Database["public"]["Enums"]["player_role"] | null
          summoner_id: string | null
          tag_line: string | null
        }
        SetofOptions: {
          from: "*"
          to: "players"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      bump_group_live: {
        Args: { p_group: string; p_kind: string }
        Returns: number
      }
      create_group: {
        Args: {
          p_created_by: string
          p_name: string
          p_player_id: string
          p_slug: string
        }
        Returns: {
          group_id: string
          outcome: string
        }[]
      }
      current_player_id: { Args: never; Returns: string }
      is_group_admin: { Args: { p_group_id: string }; Returns: boolean }
      mode_hand_back: {
        Args: {
          p_class_tag: string
          p_group_id: string
          p_rated: boolean
          p_region_blue: string
          p_region_red: string
          p_rule: string
        }
        Returns: boolean
      }
      mode_take: {
        Args: {
          p_empty_row: boolean
          p_group_id: string
          p_lobby_id: string
          p_lock_class_tag: string
          p_lock_mode: string
          p_lock_rated: boolean
          p_lock_region_blue: string
          p_lock_region_red: string
          p_lock_rule: string
          p_read_class_tag: string
          p_read_rated: boolean
          p_read_region_blue: string
          p_read_region_red: string
          p_read_rule: string
          p_read_standing: string
          p_statuses: string[]
        }
        Returns: string
      }
      new_invite_code: { Args: never; Returns: string }
      pairing_attempt: {
        Args: { p_ip_hash: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      redeem_pairing_code: {
        Args: { p_code_hash: string; p_puuid: string }
        Returns: {
          group_id: string
          linked_name: string
          outcome: string
        }[]
      }
      remove_group_member: {
        Args: { p_actor_id: string; p_group_id: string; p_player_id: string }
        Returns: string
      }
      reset_group_ratings: {
        Args: { p_actor_id: string; p_group_id: string; p_now?: string }
        Returns: string
      }
      rotate_group_invite: {
        Args: { p_group_id: string; p_rotated_by: string }
        Returns: string
      }
      session_player: {
        Args: { p_group_id?: string; p_session_id: string; p_user_id: string }
        Returns: {
          discord_id: string
          display_name: string
          player_id: string
          puuid: string
          role: string
        }[]
      }
      set_group_member_role_v2: {
        Args: {
          p_actor_id: string
          p_group_id: string
          p_player_id: string
          p_role: string
        }
        Returns: string
      }
      transfer_group_ownership: {
        Args: { p_actor_id: string; p_group_id: string; p_player_id: string }
        Returns: string
      }
    }
    Enums: {
      companion_command_kind: "create_lobby" | "invite" | "switch_side"
      companion_command_status: "pending" | "sent" | "acked" | "failed"
      game_source: "eog" | "backfill"
      lobby_status:
        | "open"
        | "balanced"
        | "in_game"
        | "dropped"
        | "finished"
        | "abandoned"
      player_role: "top" | "jungle" | "mid" | "adc" | "support"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      companion_command_kind: ["create_lobby", "invite", "switch_side"],
      companion_command_status: ["pending", "sent", "acked", "failed"],
      game_source: ["eog", "backfill"],
      lobby_status: [
        "open",
        "balanced",
        "in_game",
        "dropped",
        "finished",
        "abandoned",
      ],
      player_role: ["top", "jungle", "mid", "adc", "support"],
    },
  },
} as const

