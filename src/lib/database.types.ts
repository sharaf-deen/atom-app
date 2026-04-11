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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      app_schedule: {
        Row: {
          content: string
          key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content: string
          key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      attendance: {
        Row: {
          date: string
          device_tag: string | null
          from_sessions: boolean
          id: string
          member_id: string
          scan_time: string | null
          scanned_at: string | null
          scanned_by: string | null
          source: string
          status: string
          subscription_id: string | null
          valid: boolean | null
        }
        Insert: {
          date?: string
          device_tag?: string | null
          from_sessions?: boolean
          id?: string
          member_id: string
          scan_time?: string | null
          scanned_at?: string | null
          scanned_by?: string | null
          source?: string
          status?: string
          subscription_id?: string | null
          valid?: boolean | null
        }
        Update: {
          date?: string
          device_tag?: string | null
          from_sessions?: boolean
          id?: string
          member_id?: string
          scan_time?: string | null
          scanned_at?: string | null
          scanned_by?: string | null
          source?: string
          status?: string
          subscription_id?: string | null
          valid?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_member_fk"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "attendance_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          action_details: Json | null
          actor_user_id: string | null
          created_at: string | null
          id: string
          target_user_id: string
        }
        Insert: {
          action: string
          action_details?: Json | null
          actor_user_id?: string | null
          created_at?: string | null
          id?: string
          target_user_id: string
        }
        Update: {
          action?: string
          action_details?: Json | null
          actor_user_id?: string | null
          created_at?: string | null
          id?: string
          target_user_id?: string
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          created_at: string
          group_name: string
          is_active: boolean
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          group_name: string
          is_active?: boolean
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          group_name?: string
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category_key: string
          created_at: string | null
          created_by: string | null
          date: string
          description: string | null
          id: string
        }
        Insert: {
          amount: number
          category_key: string
          created_at?: string | null
          created_by?: string | null
          date?: string
          description?: string | null
          id?: string
        }
        Update: {
          amount?: number
          category_key?: string
          created_at?: string | null
          created_by?: string | null
          date?: string
          description?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_fk"
            columns: ["category_key"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["key"]
          },
        ]
      }
      freeze_requests: {
        Row: {
          admin_note: string | null
          created_at: string
          id: string
          member_user_id: string
          processed_at: string | null
          processed_by: string | null
          reason: string
          requested_start_date: string
          status: Database["public"]["Enums"]["freeze_request_status"]
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          id?: string
          member_user_id: string
          processed_at?: string | null
          processed_by?: string | null
          reason: string
          requested_start_date: string
          status?: Database["public"]["Enums"]["freeze_request_status"]
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          id?: string
          member_user_id?: string
          processed_at?: string | null
          processed_by?: string | null
          reason?: string
          requested_start_date?: string
          status?: Database["public"]["Enums"]["freeze_request_status"]
        }
        Relationships: [
          {
            foreignKeyName: "freeze_requests_member_fk"
            columns: ["member_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "freeze_requests_processed_fk"
            columns: ["processed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          member_id: string
          read_at: string | null
          title: string | null
          user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          member_id: string
          read_at?: string | null
          title?: string | null
          user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          member_id?: string
          read_at?: string | null
          title?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notifications_outbox: {
        Row: {
          body: string
          created_at: string
          email: string
          error: string | null
          id: string
          kind: string
          member_id: string
          sent_at: string | null
          subject: string
          subscription_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          email: string
          error?: string | null
          id?: string
          kind: string
          member_id: string
          sent_at?: string | null
          subject: string
          subscription_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          email?: string
          error?: string | null
          id?: string
          kind?: string
          member_id?: string
          sent_at?: string | null
          subject?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_outbox_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_outbox_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          paid_at: string
          subscription_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_at?: string
          subscription_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          paid_at?: string
          subscription_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          date_of_birth: string | null
          email: string | null
          first_name: string | null
          id_photo_path: string | null
          last_name: string | null
          member_id: string | null
          phone: string | null
          phone_digits: string | null
          qr_code: string | null
          role: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          first_name?: string | null
          id_photo_path?: string | null
          last_name?: string | null
          member_id?: string | null
          phone?: string | null
          phone_digits?: string | null
          qr_code?: string | null
          role?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          date_of_birth?: string | null
          email?: string | null
          first_name?: string | null
          id_photo_path?: string | null
          last_name?: string | null
          member_id?: string | null
          phone?: string | null
          phone_digits?: string | null
          qr_code?: string | null
          role?: string | null
          user_id?: string
        }
        Relationships: []
      }
      promotions: {
        Row: {
          applies_to: string[]
          created_at: string
          created_by: string | null
          description: string | null
          discount_type: Database["public"]["Enums"]["promo_discount_type"]
          discount_value: number
          end_date: string | null
          id: string
          min_months: number | null
          start_date: string | null
          title: string
          updated_at: string
        }
        Insert: {
          applies_to?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_type: Database["public"]["Enums"]["promo_discount_type"]
          discount_value: number
          end_date?: string | null
          id?: string
          min_months?: number | null
          start_date?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          applies_to?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_type?: Database["public"]["Enums"]["promo_discount_type"]
          discount_value?: number
          end_date?: string | null
          id?: string
          min_months?: number | null
          start_date?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      roles: {
        Row: {
          id: string
          label: string
        }
        Insert: {
          id: string
          label: string
        }
        Update: {
          id?: string
          label?: string
        }
        Relationships: []
      }
      store_order_items: {
        Row: {
          currency: string | null
          discount_percent: number
          final_price_cents: number
          id: string
          name: string | null
          order_id: string
          owner_uid: string | null
          product_id: string
          qty: number
          stock_deducted: boolean
          unit_price_cents: number
        }
        Insert: {
          currency?: string | null
          discount_percent?: number
          final_price_cents: number
          id?: string
          name?: string | null
          order_id: string
          owner_uid?: string | null
          product_id: string
          qty: number
          stock_deducted?: boolean
          unit_price_cents: number
        }
        Update: {
          currency?: string | null
          discount_percent?: number
          final_price_cents?: number
          id?: string
          name?: string | null
          order_id?: string
          owner_uid?: string | null
          product_id?: string
          qty?: number
          stock_deducted?: boolean
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "store_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "store_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
        ]
      }
      store_order_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          order_id: string
          sender_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          order_id: string
          sender_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          order_id?: string
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_order_messages_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "store_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_order_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      store_orders: {
        Row: {
          created_at: string
          created_by: string
          discount_pct: number
          discount_percent: number
          id: string
          member_id: string
          note: string | null
          notes: string | null
          owner_uid: string | null
          payment_method: string | null
          preferred_payment: string | null
          role_snapshot: string | null
          status: string
          total_cents: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          discount_pct?: number
          discount_percent?: number
          id?: string
          member_id: string
          note?: string | null
          notes?: string | null
          owner_uid?: string | null
          payment_method?: string | null
          preferred_payment?: string | null
          role_snapshot?: string | null
          status?: string
          total_cents?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          discount_pct?: number
          discount_percent?: number
          id?: string
          member_id?: string
          note?: string | null
          notes?: string | null
          owner_uid?: string | null
          payment_method?: string | null
          preferred_payment?: string | null
          role_snapshot?: string | null
          status?: string
          total_cents?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_orders_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      store_product_categories: {
        Row: {
          created_at: string
          created_by: string | null
          is_active: boolean
          key: string
          label: string
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          is_active?: boolean
          key: string
          label: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_product_categories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "store_product_categories_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      store_products: {
        Row: {
          category: string
          color: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          id: string
          image_path: string | null
          inventory_qty: number
          is_active: boolean
          name: string
          price_cents: number
          size: string | null
          updated_at: string
        }
        Insert: {
          category: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          id?: string
          image_path?: string | null
          inventory_qty?: number
          is_active?: boolean
          name: string
          price_cents: number
          size?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          color?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          id?: string
          image_path?: string | null
          inventory_qty?: number
          is_active?: boolean
          name?: string
          price_cents?: number
          size?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_products_category_fkey"
            columns: ["category"]
            isOneToOne: false
            referencedRelation: "store_product_categories"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "store_products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount: number | null
          created_at: string | null
          end_date: string | null
          frozen_until: string | null
          id: string
          member_id: string
          paid_at: string | null
          plan: string
          remaining_classes: number | null
          sessions_total: number | null
          sessions_used: number | null
          start_date: string
          status: string
          subscription_type: string
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          end_date?: string | null
          frozen_until?: string | null
          id?: string
          member_id: string
          paid_at?: string | null
          plan: string
          remaining_classes?: number | null
          sessions_total?: number | null
          sessions_used?: number | null
          start_date?: string
          status?: string
          subscription_type?: string
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          end_date?: string | null
          frozen_until?: string | null
          id?: string
          member_id?: string
          paid_at?: string | null
          plan?: string
          remaining_classes?: number | null
          sessions_total?: number | null
          sessions_used?: number | null
          start_date?: string
          status?: string
          subscription_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      attendance_with_day: {
        Row: {
          attended_on: string | null
          date: string | null
          device_tag: string | null
          from_sessions: boolean | null
          id: string | null
          member_id: string | null
          scan_time: string | null
          scanned_at: string | null
          scanned_by: string | null
          status: string | null
          subscription_id: string | null
          valid: boolean | null
        }
        Insert: {
          attended_on?: string | null
          date?: string | null
          device_tag?: string | null
          from_sessions?: boolean | null
          id?: string | null
          member_id?: string | null
          scan_time?: string | null
          scanned_at?: string | null
          scanned_by?: string | null
          status?: string | null
          subscription_id?: string | null
          valid?: boolean | null
        }
        Update: {
          attended_on?: string | null
          date?: string | null
          device_tag?: string | null
          from_sessions?: boolean | null
          id?: string | null
          member_id?: string | null
          scan_time?: string | null
          scanned_at?: string | null
          scanned_by?: string | null
          status?: string | null
          subscription_id?: string | null
          valid?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_member_fk"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "attendance_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      atom_active_by_type_today: {
        Args: never
        Returns: {
          dropin: number
          monthly: number
          quarterly: number
          yearly: number
        }[]
      }
      atom_active_members: {
        Args: { p_today: string }
        Returns: {
          count: number
        }[]
      }
      atom_active_members_today: {
        Args: never
        Returns: {
          count: number
        }[]
      }
      atom_dropin_with_credits: {
        Args: { p_today: string }
        Returns: {
          count: number
        }[]
      }
      atom_dropin_with_credits_today: {
        Args: never
        Returns: {
          count: number
        }[]
      }
      atom_expiring_in_7_days: {
        Args: { p_today: string }
        Returns: {
          count: number
        }[]
      }
      atom_expiring_in_7_days_from_today: {
        Args: never
        Returns: {
          count: number
        }[]
      }
      atom_todays_checkins: {
        Args: { p_today: string }
        Returns: {
          count: number
        }[]
      }
      atom_todays_checkins_today: {
        Args: never
        Returns: {
          count: number
        }[]
      }
      consume_one_session: { Args: { p_member_id: string }; Returns: string }
      expire_subscriptions: { Args: never; Returns: Json }
      generate_member_id: { Args: never; Returns: string }
      is_admin: { Args: { p_uid?: string }; Returns: boolean }
      is_admin_or_super_admin: { Args: { uid: string }; Returns: boolean }
      is_ops:
        | { Args: never; Returns: boolean }
        | { Args: { uid: string }; Returns: boolean }
      is_staff: { Args: { uid: string }; Returns: boolean }
      is_super_admin:
        | { Args: never; Returns: boolean }
        | { Args: { uid: string }; Returns: boolean }
      scan_and_record: { Args: { p_member_id: string }; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      freeze_request_status: "pending" | "approved" | "denied" | "canceled"
      payment_method: "cash" | "card" | "transfer" | "online"
      promo_discount_type: "percent" | "amount"
      user_role: "admin" | "coach" | "assistant_coach" | "head_coach" | "member" | "champion" | "vip" | "reception" | "super_admin"
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
      freeze_request_status: ["pending", "approved", "denied", "canceled"],
      payment_method: ["cash", "card", "transfer", "online"],
      promo_discount_type: ["percent", "amount"],
      user_role: ["admin", "coach", "assistant_coach", "head_coach", "member", "champion", "vip", "reception", "super_admin"],
    },
  },
} as const
