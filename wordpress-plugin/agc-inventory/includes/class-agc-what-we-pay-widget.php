<?php
/**
 * Elementor widget: AGC What We Pay.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

if ( ! class_exists( '\\Elementor\\Widget_Base' ) ) {
    return;
}

class AGC_What_We_Pay_Widget extends \Elementor\Widget_Base {

    public function get_name() {
        return 'agc_what_we_pay';
    }

    public function get_title() {
        return 'AGC What We Pay';
    }

    public function get_icon() {
        return 'eicon-price-list';
    }

    public function get_categories() {
        return [ 'agc-desk' ];
    }

    public function get_keywords() {
        return [ 'agc', 'buy', 'price', 'bullion', 'coin', 'quote' ];
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
        echo agc_inv_render_what_we_pay( [
            'metal' => $settings['metal'] ?? '',
        ] );
    }
}
