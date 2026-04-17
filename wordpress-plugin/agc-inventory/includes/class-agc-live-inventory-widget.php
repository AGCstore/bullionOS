<?php
/**
 * Elementor widget: AGC Live Inventory.
 *
 * Renders the same HTML as the [agc_live_inventory] shortcode so the
 * frontend JS picker (assets/agc-inventory.js) drives both without
 * branching.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

if ( ! class_exists( '\\Elementor\\Widget_Base' ) ) {
    return;
}

class AGC_Live_Inventory_Widget extends \Elementor\Widget_Base {

    public function get_name() {
        return 'agc_live_inventory';
    }

    public function get_title() {
        return 'AGC Live Inventory';
    }

    public function get_icon() {
        return 'eicon-product-stock';
    }

    public function get_categories() {
        return [ 'agc-desk' ];
    }

    public function get_keywords() {
        return [ 'agc', 'inventory', 'stock', 'live', 'bullion', 'coin' ];
    }

    protected function register_controls() {
        $this->start_controls_section( 'content_section', [
            'label' => 'Content',
            'tab'   => \Elementor\Controls_Manager::TAB_CONTENT,
        ] );

        $this->add_control( 'metal', [
            'label'   => 'Metal filter',
            'type'    => \Elementor\Controls_Manager::SELECT,
            'default' => '',
            'options' => [
                ''          => 'All metals',
                'gold'      => 'Gold only',
                'silver'    => 'Silver only',
                'platinum'  => 'Platinum only',
                'palladium' => 'Palladium only',
            ],
        ] );

        $this->end_controls_section();
    }

    protected function render() {
        $settings = $this->get_settings_for_display();
        echo agc_inv_render_live_inventory( [
            'metal' => $settings['metal'] ?? '',
        ] );
    }
}
